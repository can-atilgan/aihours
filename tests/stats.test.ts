import { describe, it, expect } from 'vitest';
import { calcStats, formatDuration } from '../src/stats';
import { type ActivityFile } from '../src/activityProcessor';
import { AFK_THRESHOLD_MS, STREAK_MIN_MS } from '../src/config';

const MIN = 60_000;
const HR  = 60 * MIN;

// Fixed past date so tests are never time-sensitive
const BASE = new Date('2026-02-15T10:00:00.000Z');

function t(base: Date, ms = 0): string {
  return new Date(+base + ms).toISOString();
}

function af(activities: ActivityFile['activities'], last_reset_at: string | null = null): ActivityFile {
  return { last_updated_at: new Date().toISOString(), last_reset_at, last_events_size: 0, activities };
}

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('0ms → 0m 0s', () => expect(formatDuration(0)).toBe('0m 0s'));
  it('45s',         () => expect(formatDuration(45_000)).toBe('0m 45s'));
  it('1m 30s',      () => expect(formatDuration(90_000)).toBe('1m 30s'));
  it('1h 5m',       () => expect(formatDuration(65 * MIN)).toBe('1h 5m'));
  it('1d 1h',       () => expect(formatDuration(25 * HR)).toBe('1d 1h'));
});

// ── calcStats — empty ─────────────────────────────────────────────────────────

describe('calcStats — empty', () => {
  it('all zeros for no activities', () => {
    const s = calcStats(af([]));
    expect(s.todayActiveAiTime).toBe(0);
    expect(s.activeAiTime).toBe(0);
    expect(s.everActiveAiTime).toBe(0);
    expect(s.currentStreak).toBe(0);
    expect(s.longestStreak).toBe(0);
  });
});

// ── calcStats — active AI time ────────────────────────────────────────────────

describe('calcStats — active AI time', () => {
  it('closed activity: active = end - start', () => {
    const s = calcStats(af([
      { start: t(BASE, 0), end: t(BASE, 30 * MIN) },
    ]));
    expect(s.activeAiTime).toBeCloseTo(30 * MIN, -2);
    expect(s.everActiveAiTime).toBeCloseTo(30 * MIN, -2);
  });

  it('two closed activities sum correctly', () => {
    const s = calcStats(af([
      { start: t(BASE, 0),        end: t(BASE, 10 * MIN) },
      { start: t(BASE, 60 * MIN), end: t(BASE, 80 * MIN) },
    ]));
    expect(s.activeAiTime).toBeCloseTo(30 * MIN, -2);
  });

  it('period filter: only activities after last_reset_at count for activeAiTime', () => {
    const resetTs = t(BASE, 30 * MIN);
    const s = calcStats(af([
      { start: t(BASE, 0),        end: t(BASE, 20 * MIN) }, // before reset
      { start: t(BASE, 40 * MIN), end: t(BASE, 60 * MIN) }, // after reset
    ], resetTs));
    expect(s.activeAiTime).toBeCloseTo(20 * MIN, -2);   // only post-reset
    expect(s.everActiveAiTime).toBeCloseTo(40 * MIN, -2); // all time
  });

  it('today filter: past activities do not appear in todayActiveAiTime', () => {
    const s = calcStats(af([
      { start: t(BASE, 0), end: t(BASE, 30 * MIN) }, // BASE = Feb 15, not today
    ]));
    expect(s.todayActiveAiTime).toBe(0);
  });

  it('today filter: today activities appear in todayActiveAiTime', () => {
    const today = new Date(); today.setHours(9, 0, 0, 0);
    const s = calcStats(af([
      { start: new Date(+today).toISOString(), end: new Date(+today + 20 * MIN).toISOString() },
    ]));
    expect(s.todayActiveAiTime).toBeCloseTo(20 * MIN, -2);
  });
});

// ── calcStats — live (open) activity ─────────────────────────────────────────

describe('calcStats — open activity', () => {
  it('isAiActive = true when open activity has no lastClaudeDone', () => {
    const s = calcStats(af([
      { start: new Date().toISOString() },
    ]));
    expect(s.isAiActive).toBe(true);
  });

  it('isAiActive = true when lastClaudeDone is within AFK window', () => {
    const now = Date.now();
    const s = calcStats(af([
      { start: new Date(now - AFK_THRESHOLD_MS * 2).toISOString(), lastClaudeDone: new Date(now - AFK_THRESHOLD_MS / 2).toISOString() },
    ]));
    expect(s.isAiActive).toBe(true);
  });

  it('isAiActive = false when lastClaudeDone is past AFK window', () => {
    const now = Date.now();
    const s = calcStats(af([
      { start: new Date(now - AFK_THRESHOLD_MS * 3).toISOString(), lastClaudeDone: new Date(now - AFK_THRESHOLD_MS * 2).toISOString() },
    ]));
    expect(s.isAiActive).toBe(false);
  });
});

// ── calcStats — streaks ───────────────────────────────────────────────────────

describe('calcStats — streaks', () => {
  it('1-day streak when today has ≥ streak threshold active AI', () => {
    const today = new Date(); today.setHours(10, 0, 0, 0);
    const s = calcStats(af([
      { start: new Date(+today).toISOString(), end: new Date(+today + STREAK_MIN_MS + MIN).toISOString() },
    ]));
    expect(s.currentStreak).toBe(1);
    expect(s.longestStreak).toBe(1);
  });

  it('no streak when today has < streak threshold active AI', () => {
    const today = new Date(); today.setHours(10, 0, 0, 0);
    const s = calcStats(af([
      { start: new Date(+today).toISOString(), end: new Date(+today + STREAK_MIN_MS / 2).toISOString() },
    ]));
    expect(s.currentStreak).toBe(0);
  });

  it('longest streak spans consecutive qualifying days', () => {
    const day1 = new Date('2026-02-10T10:00:00.000Z');
    const day2 = new Date('2026-02-11T10:00:00.000Z');
    const s = calcStats(af([
      { start: new Date(+day1).toISOString(), end: new Date(+day1 + STREAK_MIN_MS + MIN).toISOString() },
      { start: new Date(+day2).toISOString(), end: new Date(+day2 + STREAK_MIN_MS + MIN).toISOString() },
    ]));
    expect(s.longestStreak).toBe(2);
  });
});

// ── activityProcessor — event handling ───────────────────────────────────────

import * as fs   from 'fs';
import * as os   from 'os';
import * as path from 'path';
import { processEvents, readActivityFile } from '../src/activityProcessor';

const TMP = path.join(os.tmpdir(), 'clocked-test');

function setup() {
  fs.mkdirSync(TMP, { recursive: true });
  const ap = path.join(TMP, 'activity.json');
  const ep = path.join(TMP, 'events.jsonl');
  if (fs.existsSync(ap)) fs.unlinkSync(ap);
  if (fs.existsSync(ep)) fs.unlinkSync(ep);
  return { ap, ep };
}

function writeEvents(ep: string, events: { ts: string; event: string }[]) {
  fs.writeFileSync(ep, events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function writeActivity(ap: string, data: ActivityFile) {
  fs.writeFileSync(ap, JSON.stringify(data));
}

describe('processEvents — first run', () => {
  it('creates empty activity.json and renames events.jsonl if no activity.json', () => {
    const { ap, ep } = setup();
    writeEvents(ep, [{ ts: t(BASE, 0), event: 'UserPromptSubmit' }]);
    processEvents(ap, ep);
    expect(fs.existsSync(ap)).toBe(true);
    expect(fs.existsSync(ep)).toBe(false); // renamed to backup
    const file = readActivityFile(ap);
    expect(file.activities).toHaveLength(0);
  });
});

describe('processEvents — no open activity', () => {
  it('UserPromptSubmit → starts new open activity', () => {
    const { ap, ep } = setup();
    const now = new Date().toISOString();
    writeActivity(ap, { last_updated_at: new Date(Date.now() - MIN).toISOString(), last_reset_at: null, last_events_size: 0, activities: [] });
    writeEvents(ep, [{ ts: now, event: 'UserPromptSubmit' }]);
    processEvents(ap, ep);
    const file = readActivityFile(ap);
    expect(file.activities).toHaveLength(1);
    expect(file.activities[0]).toMatchObject({ start: now });
    expect('end' in file.activities[0]).toBe(false);
  });

  it('Stop with no open activity → ignored', () => {
    const { ap, ep } = setup();
    writeActivity(ap, { last_updated_at: new Date(Date.now() - MIN).toISOString(), last_reset_at: null, last_events_size: 0, activities: [] });
    writeEvents(ep, [{ ts: new Date().toISOString(), event: 'Stop' }]);
    processEvents(ap, ep);
    const file = readActivityFile(ap);
    expect(file.activities).toHaveLength(0);
  });
});

describe('processEvents — open activity', () => {
  it('Stop → updates lastClaudeDone', () => {
    const { ap, ep } = setup();
    const start  = new Date(Date.now() - 10 * MIN).toISOString();
    const stopTs = new Date().toISOString();
    writeActivity(ap, { last_updated_at: new Date(Date.now() - MIN).toISOString(), last_reset_at: null, last_events_size: 0, activities: [{ start }] });
    writeEvents(ep, [{ ts: stopTs, event: 'Stop' }]);
    processEvents(ap, ep);
    const file = readActivityFile(ap);
    expect(file.activities[0]).toMatchObject({ start, lastClaudeDone: stopTs });
  });

  it('UserPromptSubmit within AFK window of lastClaudeDone → activity stays open', () => {
    const { ap, ep } = setup();
    const now       = Date.now();
    const start     = new Date(now - AFK_THRESHOLD_MS * 2).toISOString();
    const doneTs    = new Date(now - AFK_THRESHOLD_MS / 2).toISOString();
    const promptTs  = new Date(now).toISOString();
    writeActivity(ap, { last_updated_at: new Date(now - MIN).toISOString(), last_reset_at: null, last_events_size: 0, activities: [{ start, lastClaudeDone: doneTs }] });
    writeEvents(ep, [{ ts: promptTs, event: 'UserPromptSubmit' }]);
    processEvents(ap, ep);
    const file = readActivityFile(ap);
    expect(file.activities).toHaveLength(1);
    expect('end' in file.activities[0]).toBe(false);
  });

  it('UserPromptSubmit after AFK window of lastClaudeDone → closes old, starts new', () => {
    const { ap, ep } = setup();
    const now       = Date.now();
    const start     = new Date(now - AFK_THRESHOLD_MS * 4).toISOString();
    const doneTs    = new Date(now - AFK_THRESHOLD_MS * 2).toISOString();
    const promptTs  = new Date(now).toISOString();
    writeActivity(ap, { last_updated_at: new Date(now - MIN).toISOString(), last_reset_at: null, last_events_size: 0, activities: [{ start, lastClaudeDone: doneTs }] });
    writeEvents(ep, [{ ts: promptTs, event: 'UserPromptSubmit' }]);
    processEvents(ap, ep);
    const file = readActivityFile(ap);
    expect(file.activities).toHaveLength(2);
    expect('end' in file.activities[0]).toBe(true);
    expect(file.activities[1]).toMatchObject({ start: promptTs });
  });

  it('timer check: lastClaudeDone past AFK window → closes activity', () => {
    const { ap, ep } = setup();
    const now     = Date.now();
    const start   = new Date(now - AFK_THRESHOLD_MS * 4).toISOString();
    const doneTs  = new Date(now - AFK_THRESHOLD_MS * 2).toISOString();
    writeActivity(ap, { last_updated_at: new Date(now - MIN).toISOString(), last_reset_at: null, last_events_size: 0, activities: [{ start, lastClaudeDone: doneTs }] });
    writeEvents(ep, []); // no new events
    processEvents(ap, ep);
    const file = readActivityFile(ap);
    expect('end' in file.activities[0]).toBe(true);
  });

  it('timer check: no lastClaudeDone → activity stays open', () => {
    const { ap, ep } = setup();
    const now   = Date.now();
    const start = new Date(now - 60 * MIN).toISOString();
    writeActivity(ap, { last_updated_at: new Date(now - MIN).toISOString(), last_reset_at: null, last_events_size: 0, activities: [{ start }] });
    writeEvents(ep, []); // no new events
    processEvents(ap, ep);
    const file = readActivityFile(ap);
    expect('end' in file.activities[0]).toBe(false);
  });

  it('StatsReset → updates last_reset_at', () => {
    const { ap, ep } = setup();
    const now      = Date.now();
    const resetTs  = new Date(now).toISOString();
    writeActivity(ap, { last_updated_at: new Date(now - MIN).toISOString(), last_reset_at: null, last_events_size: 0, activities: [] });
    writeEvents(ep, [{ ts: resetTs, event: 'StatsReset' }]);
    processEvents(ap, ep);
    const file = readActivityFile(ap);
    expect(file.last_reset_at).toBe(resetTs);
  });
});
