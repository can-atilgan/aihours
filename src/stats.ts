import * as fs   from 'fs';
import * as os   from 'os';
import * as path from 'path';

import {
  type Activity,
  type ActivityFile,
  type OpenActivity,
  isClosed,
  readActivityFile,
} from './activityProcessor';

import { AFK_THRESHOLD_MS, STREAK_MIN_MS } from './config';

export interface Stats {
  // Today (local calendar day)
  todayActiveAiTime:  number; // ms
  // Period AI (since last reset)
  activeAiTime:  number; // ms
  // Ever AI — ignores StatsReset
  everActiveAiTime: number; // ms
  // Streaks
  currentStreak: number; // days
  longestStreak: number; // days
  // Dates
  periodStart:   string | null;
  firstRecorded: string | null;
  // Live state
  isAiActive: boolean;
}

// ── VSCode event appender (used by extension) ─────────────────────────────────

interface RawEvent {
  ts:         string;
  event:      string;
  session_id: string;
  cwd:        string;
  tool:       string | null;
  meta:       Record<string, string> | null;
}

const LOG_PATH = path.join(os.homedir(), '.aihours', 'events.jsonl');

export function appendEvent(event: { event: string; cwd: string }): void {
  const line: RawEvent = {
    ts:         new Date().toISOString(),
    event:      event.event,
    session_id: 'vscode',
    cwd:        event.cwd,
    tool:       null,
    meta:       null,
  };
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(line) + '\n');
}

// ── Active AI time ────────────────────────────────────────────────────────────

// Clips a value to [lo, hi]
function clip(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Returns active ms for a single activity, optionally clipped to [fromMs, toMs].
function activityActiveMs(a: Activity, fromMs = -Infinity, toMs = Infinity): number {
  const startMs = +new Date((a as OpenActivity).start);

  if (isClosed(a)) {
    const endMs = +new Date(a.end);
    const s = clip(startMs, fromMs, toMs);
    const e = clip(endMs,   fromMs, toMs);
    return Math.max(0, e - s);
  }

  // Open activity
  const open   = a as OpenActivity;
  const nowMs  = Date.now();
  const endMs  = open.lastClaudeDone
    ? Math.min(+new Date(open.lastClaudeDone) + AFK_THRESHOLD_MS, nowMs)
    : nowMs;

  const s = clip(startMs, fromMs, toMs);
  const e = clip(endMs,   fromMs, toMs);
  return Math.max(0, e - s);
}

export function calcActiveMs(activities: Activity[], fromMs?: number, toMs?: number): number {
  return activities.reduce((sum, a) => sum + activityActiveMs(a, fromMs, toMs), 0);
}

// ── Active AI time per local calendar day (for streaks) ───────────────────────

function localDayKey(d: Date): string {
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD local
}

function localDayBounds(dateKey: string): [number, number] {
  const d = new Date(dateKey + 'T00:00:00');
  const start = d.getTime();
  d.setDate(d.getDate() + 1);
  return [start, d.getTime()];
}

export function activeAiByDay(activities: Activity[]): Map<string, number> {
  // Collect all unique local days touched by any activity
  const days = new Set<string>();
  const nowMs = Date.now();

  for (const a of activities) {
    const startMs = +new Date((a as OpenActivity).start);
    const endMs   = isClosed(a)
      ? +new Date(a.end)
      : (a as OpenActivity).lastClaudeDone
        ? Math.min(+new Date((a as OpenActivity).lastClaudeDone!) + AFK_THRESHOLD_MS, nowMs)
        : nowMs;

    // Walk each midnight between start and end
    const d = new Date(startMs);
    d.setHours(0, 0, 0, 0);
    while (d.getTime() <= endMs) {
      days.add(localDayKey(d));
      d.setDate(d.getDate() + 1);
    }
  }

  const byDay = new Map<string, number>();
  for (const day of days) {
    const [from, to] = localDayBounds(day);
    const ms = calcActiveMs(activities, from, to);
    if (ms > 0) byDay.set(day, ms);
  }
  return byDay;
}

// ── Live state ────────────────────────────────────────────────────────────────

export function isAiActive(activities: Activity[]): boolean {
  if (activities.length === 0) return false;
  const last = activities[activities.length - 1];
  if (isClosed(last)) return false;
  const open = last as OpenActivity;
  if (!open.lastClaudeDone) return true; // Claude still working
  return Date.now() - +new Date(open.lastClaudeDone) < AFK_THRESHOLD_MS;
}

// ── Streaks ───────────────────────────────────────────────────────────────────

function streakEndingAt(byDay: Map<string, number>, date: Date): number {
  let count = 0;
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  while ((byDay.get(localDayKey(d)) ?? 0) >= STREAK_MIN_MS) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

function calcLongestStreak(byDay: Map<string, number>): number {
  if (byDay.size === 0) return 0;
  const start = new Date(Array.from(byDay.keys()).sort()[0]);
  const end   = new Date(); end.setHours(12, 0, 0, 0);
  let best = 0, run = 0;
  const d = new Date(start); d.setHours(12, 0, 0, 0);
  while (d <= end) {
    if ((byDay.get(localDayKey(d)) ?? 0) >= STREAK_MIN_MS) { run++; best = Math.max(best, run); }
    else run = 0;
    d.setDate(d.getDate() + 1);
  }
  return best;
}

// ── Public ────────────────────────────────────────────────────────────────────

export function calcStats(activityFile?: ActivityFile): Stats {
  const file = activityFile ?? readActivityFile();
  const { activities, last_reset_at } = file;

  // Today bounds
  const todayKey             = localDayKey(new Date());
  const [todayFrom, todayTo] = localDayBounds(todayKey);

  // Active AI time
  // Today and ever use all activities (reset doesn't affect these views)
  // Period clips each activity's contribution to after the reset timestamp
  const resetMs           = last_reset_at ? +new Date(last_reset_at) : -Infinity;
  const todayActiveAiTime = calcActiveMs(activities, todayFrom, todayTo);
  const activeAiTime      = calcActiveMs(activities, resetMs);
  const everActiveAiTime  = calcActiveMs(activities);

  // Streaks use all-time activities (resets don't break streaks)
  const byDay       = activeAiByDay(activities);
  const yesterday   = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const streakToday = streakEndingAt(byDay, new Date());
  const streakYest  = streakEndingAt(byDay, yesterday);

  // Dates
  const periodStart   = last_reset_at ?? (activities[0] as OpenActivity | undefined)?.start ?? null;
  const firstRecorded = (activities[0] as OpenActivity | undefined)?.start ?? null;

  return {
    todayActiveAiTime,
    activeAiTime,
    everActiveAiTime,
    currentStreak:  streakToday > 0 ? streakToday : streakYest,
    longestStreak:  calcLongestStreak(byDay),
    periodStart,
    firstRecorded,
    isAiActive:     isAiActive(activities),
  };
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatFullDuration(ms: number): string {
  const totalSec  = Math.floor(ms / 1000);
  const s         = totalSec % 60;
  const totalMin  = Math.floor(totalSec / 60);
  const m         = totalMin % 60;
  const totalHr   = Math.floor(totalMin / 60);
  const h         = totalHr % 24;
  const totalDays = Math.floor(totalHr / 24);
  const d         = totalDays % 30;
  const mo        = Math.floor(totalDays / 30);

  const parts: string[] = [];
  if (mo > 0) parts.push(`${mo}mo`);
  if (d  > 0 || mo > 0) parts.push(`${d}d`);
  if (h  > 0 || d  > 0 || mo > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const totalHr = Math.floor(totalMin / 60);
  const h = totalHr % 24;
  const d = Math.floor(totalHr / 24);

  if (d > 0)       return `${d}d ${h}h`;
  if (totalHr > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}
