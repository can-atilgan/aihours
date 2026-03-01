# Timing Logic

## events.jsonl

Append-only. Events land in real-time order — no sorting needed.
Concurrent sessions interleave naturally (whichever hook fired first).

Each line is a JSON event with at minimum: `ts`, `event`, `session_id`.

Relevant event types:
- `UserPromptSubmit` — user sent a prompt
- `Stop` — claude finished responding
- `SessionEnd` — session closed (any reason: normal, crash, force quit)

`Stop` and `SessionEnd` are treated identically for AFK purposes: both mean "claude is done".

## Cross-session AFK detection

Ignore session boundaries. Treat all events as one unified timeline.

AFK gap = when `lastClaudeDone + 20min` passes with no new `UserPromptSubmit`.

## Activity periods

Only track active time. No total time.

Closed activity: `{ start, end }` — `end = lastClaudeDone + 20min`
Open activity:   `{ start, lastClaudeDone }` — still building or in grace window

`lastClaudeDone` is only stored on the open activity. Once closed, replaced by `end`.

### Event handling

**No open activity:**
- `UserPromptSubmit` → start new open activity `{ start: event.ts }`
- `Stop` / `SessionEnd` → ignore

**Open activity exists** (process new events in chronological order):
- `Stop` / `SessionEnd` → update open activity's `lastClaudeDone`
- `UserPromptSubmit` and `now - lastClaudeDone <= 20min` → activity stays open
- `UserPromptSubmit` and `now - lastClaudeDone > 20min` → close activity at `lastClaudeDone + 20min`, start new open activity at `event.ts`

**After processing all new events — timer check:**
- If open activity has `lastClaudeDone` and `now - lastClaudeDone > 20min` → close at `lastClaudeDone + 20min`
- If open activity has no `lastClaudeDone` → skip, Claude is still working

### Day boundaries

Activities are stored as raw timestamps. Day/month boundaries are irrelevant at storage time.
At read time, slice activities by the requested boundary (today, this week, etc.).
An activity spanning multiple days is split at each midnight when computing per-day stats.

## activity.json

Processed file, rewritten on each refresh.

```json
{
  "last_updated_at": "2026-03-01T16:30:00Z",
  "activities": [
    { "start": "2026-03-01T10:00:00Z", "end": "2026-03-01T10:45:00Z" },
    { "start": "2026-03-01T14:00:00Z", "lastClaudeDone": "2026-03-01T14:05:00Z" }
  ]
}
```

On each refresh:
1. Read `last_updated_at` from `activity.json`
2. Scan `events.jsonl` backwards until that timestamp to get new events
3. Process new events in chronological order using rules above
4. Run timer check on open activity
5. Rewrite `activity.json` with `last_updated_at = now`

Stats read from `activity.json` directly — no JSONL parsing needed for display.

## First run (no activity.json)

Rename `events.jsonl` to `events.backup.YYYY-MM-DD.jsonl`. Start fresh with empty files.
