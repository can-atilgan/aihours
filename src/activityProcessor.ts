import * as fs   from 'fs';
import * as os   from 'os';
import * as path from 'path';

import { AFK_THRESHOLD_MS } from './config';

const DEFAULT_ACTIVITY_PATH = path.join(os.homedir(), '.clocked', 'activity.json');
const DEFAULT_EVENTS_PATH   = path.join(os.homedir(), '.clocked', 'events.jsonl');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClosedActivity { start: string; end: string }
export interface OpenActivity   { start: string; lastClaudeDone?: string }
export type Activity = ClosedActivity | OpenActivity;

export interface ActivityFile {
  last_updated_at:    string;
  last_checkpoint_at:  string | null;
  last_events_size:   number;          // byte size of events.jsonl at last processing
  total_ai_labor_ms:  number;          // cumulative AI response time across all sessions
  pending_prompts:    Record<string, number>;  // session_id → prompt timestamp (ms), awaiting Stop
  activities:         Activity[];
}

export function isClosed(a: Activity): a is ClosedActivity {
  return 'end' in a;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface RawEvent {
  ts:         string;
  event:      string;
  session_id?: string;
}

function readNewEvents(eventsPath: string, byteOffset: number): RawEvent[] {
  if (!fs.existsSync(eventsPath)) return [];
  const stat = fs.statSync(eventsPath);
  if (stat.size <= byteOffset) return [];
  const fd  = fs.openSync(eventsPath, 'r');
  const buf = Buffer.alloc(stat.size - byteOffset);
  fs.readSync(fd, buf, 0, buf.length, byteOffset);
  fs.closeSync(fd);
  return buf.toString('utf8')
    .split('\n')
    .filter(l => l.trim())
    .flatMap(l => { try { return [JSON.parse(l) as RawEvent]; } catch { return []; } });
}

function emptyActivityFile(now: string): ActivityFile {
  return { last_updated_at: now, last_checkpoint_at: null, last_events_size: 0, total_ai_labor_ms: 0, pending_prompts: {}, activities: [] };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function readActivityFile(activityPath = DEFAULT_ACTIVITY_PATH): ActivityFile {
  if (!fs.existsSync(activityPath)) return emptyActivityFile(new Date(0).toISOString());
  try {
    return JSON.parse(fs.readFileSync(activityPath, 'utf8')) as ActivityFile;
  } catch {
    return emptyActivityFile(new Date(0).toISOString());
  }
}

export function processEvents(
  activityPath = DEFAULT_ACTIVITY_PATH,
  eventsPath   = DEFAULT_EVENTS_PATH,
): ActivityFile {
  const now    = new Date().toISOString();
  const nowMs  = +new Date(now);
  const dir    = path.dirname(activityPath);

  // First run — no activity.json yet
  if (!fs.existsSync(activityPath)) {
    if (fs.existsSync(eventsPath)) {
      const date   = now.slice(0, 10);
      const backup = eventsPath.replace('.jsonl', `.backup.${date}.jsonl`);
      fs.renameSync(eventsPath, backup);
    }
    fs.mkdirSync(dir, { recursive: true });
    const empty = emptyActivityFile(now);
    fs.writeFileSync(activityPath, JSON.stringify(empty, null, 2));
    return empty;
  }

  // Load existing state
  const file       = readActivityFile(activityPath);
  const activities = [...file.activities];
  let lastCheckpointAt = file.last_checkpoint_at;

  // Only read new bytes appended since last run
  const currentSize = fs.existsSync(eventsPath) ? fs.statSync(eventsPath).size : 0;
  const newEvents   = currentSize > file.last_events_size
    ? readNewEvents(eventsPath, file.last_events_size)
    : [];

  // AI labor: track per-session prompt timestamps to measure response times
  let totalAiLaborMs = file.total_ai_labor_ms ?? 0;
  const pendingPrompts: Record<string, number> = { ...(file.pending_prompts ?? {}) };

  // Find the open activity (last entry with no end), if any
  const lastIdx    = activities.length - 1;
  let openIdx      = lastIdx >= 0 && !isClosed(activities[lastIdx]) ? lastIdx : -1;

  // Process new events in chronological order
  for (const ev of newEvents) {
    const evMs = +new Date(ev.ts);

    if (ev.event === 'CheckpointReset' || ev.event === 'StatsReset') {
      lastCheckpointAt = ev.ts;
      continue;
    }

    if (ev.event === 'ManualAfk') {
      if (openIdx === -1) continue;
      activities[openIdx] = { start: (activities[openIdx] as OpenActivity).start, end: ev.ts };
      openIdx = -1;
      continue;
    }

    if (ev.event === 'Stop') {
      // AI labor: accumulate response time for this session
      if (ev.session_id && pendingPrompts[ev.session_id]) {
        totalAiLaborMs += evMs - pendingPrompts[ev.session_id];
        delete pendingPrompts[ev.session_id];
      }
      if (openIdx === -1) continue;
      (activities[openIdx] as OpenActivity).lastClaudeDone = ev.ts;
      continue;
    }

    if (ev.event === 'UserPromptSubmit') {
      // AI labor: record prompt timestamp for this session
      if (ev.session_id) pendingPrompts[ev.session_id] = evMs;
      if (openIdx === -1) {
        // No open activity — start one
        activities.push({ start: ev.ts });
        openIdx = activities.length - 1;
        continue;
      }

      const open = activities[openIdx] as OpenActivity;

      if (!open.lastClaudeDone) {
        // Claude still working, no response yet — stay open
        continue;
      }

      const doneMs = +new Date(open.lastClaudeDone);

      if (evMs - doneMs <= AFK_THRESHOLD_MS) {
        // Within grace window — stay open
        continue;
      }

      // AFK confirmed — close current, start new
      activities[openIdx] = { start: open.start, end: new Date(doneMs + AFK_THRESHOLD_MS).toISOString() };
      activities.push({ start: ev.ts });
      openIdx = activities.length - 1;
    }
  }

  // Timer check — close open activity if grace window has expired
  if (openIdx !== -1) {
    const open = activities[openIdx] as OpenActivity;
    if (open.lastClaudeDone) {
      const doneMs = +new Date(open.lastClaudeDone);
      if (nowMs - doneMs > AFK_THRESHOLD_MS) {
        activities[openIdx] = { start: open.start, end: new Date(doneMs + AFK_THRESHOLD_MS).toISOString() };
      }
    }
  }

  // Rewrite activity.json
  const updated: ActivityFile = {
    last_updated_at:  now,
    last_checkpoint_at: lastCheckpointAt,
    last_events_size: currentSize,
    total_ai_labor_ms: totalAiLaborMs,
    pending_prompts: pendingPrompts,
    activities,
  };
  fs.writeFileSync(activityPath, JSON.stringify(updated, null, 2));
  return updated;
}
