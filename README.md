# AI Hours

> *You know how Steam shows you've played Stardew Valley for 847 hours and you feel weirdly proud of that? This is that — but for building with AI.*

**AI Hours** is a VSCode extension that tracks how much time you actually spend building with AI. Not time staring at the screen, not time in a meeting with your laptop open — active, in-the-zone, prompts-flying coding time.

Live status bar. Daily streak. Honest numbers.

---

## What it tracks

- **Today** — active AI building time for today
- **Since Reset** — your current period (reset whenever you want a fresh start)
- **All Time** — the full career clock, unaffected by resets
- **Building Streak** — consecutive days with 1+ hour of active AI time

Idle gaps are automatically excluded, so the number means something. If you walked away and came back 30 minutes later, that half hour doesn't pad your stats.

> **Claude Code + VSCode only for now.** Support for Cursor, Windsurf, and others is on the roadmap.

---

## Setup

### 1. Copy the hook script

```bash
mkdir -p ~/.aihours
cp hook/record.js ~/.aihours/record.js
```

### 2. Register the hooks with Claude Code

Add the following to `~/.claude/settings.json` (create it if it doesn't exist):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node ~/.aihours/record.js", "async": true }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node ~/.aihours/record.js", "async": true }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node ~/.aihours/record.js", "async": true }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node ~/.aihours/record.js", "async": true }] }]
  }
}
```

The hook runs async and never blocks Claude Code.

### 3. Install the extension

Build the `.vsix` yourself:

```bash
npm install
npm run package
```

Then in VSCode: **Extensions → ··· → Install from VSIX** and pick the generated file.

### 4. Open the panel

Click the clock icon in the secondary sidebar, or click the status bar item at the bottom right.

---

## Optional config

Drop a file at `~/.aihours/config.json` to tune the defaults:

```json
{
  "afkThresholdMin":    20,
  "streakThresholdMin": 60,
  "refreshIntervalSec": 5
}
```

| Field | Default | What it does |
|---|---|---|
| `afkThresholdMin` | `20` | Minutes of inactivity before a session is considered closed |
| `streakThresholdMin` | `60` | Minutes of active AI time needed in a day to count toward streak |
| `refreshIntervalSec` | `5` | How often the panel refreshes from disk |

Changes take effect on next VSCode reload.

---

## Data & privacy

Everything stays on your machine. All data lives in `~/.aihours/`:

- `events.jsonl` — raw hook events (append-only)
- `activity.json` — processed activity log

No telemetry, no accounts, no cloud.

---

## Built with AI

95%+ of this codebase was written by AI coding agents (mainly Claude Code + Sonnet) — tracked by AI Hours itself. We're in the best era of software development that has ever existed, and this tool exists to celebrate that.

Go build something.

---

## Contributing

Issues and PRs welcome. Be cool.
