# Clocked AI

> *You know how Steam shows you've played Dota 2 for 15,000+ hours and you feel weirdly proud of that? This is that — but for building with AI.*

**Clocked AI** is a VSCode extension that tracks how much time you actually spend building with AI. Not time staring at the screen, not time in a meeting with your laptop open — active, in-the-zone, prompts-flying coding time.

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

One command. That's it.

```bash
curl -fsSL https://raw.githubusercontent.com/can-atilgan/clocked-ai/main/install.sh | bash
```

This installs the hook script, wires Claude Code settings, and installs the VSCode extension. Restart VSCode and you're live.

Click the clock icon in the secondary sidebar, or click the status bar item at the bottom right.

---

## Manual setup

If you prefer doing it by hand:

### 1. Copy the hook script

```bash
mkdir -p ~/.clocked
cp hook/record.js ~/.clocked/record.js
```

### 2. Register the hooks with Claude Code

Add the following to `~/.claude/settings.json` (create it if it doesn't exist):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node ~/.clocked/record.js", "async": true }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node ~/.clocked/record.js", "async": true }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node ~/.clocked/record.js", "async": true }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node ~/.clocked/record.js", "async": true }] }]
  }
}
```

The hook runs async and never blocks Claude Code.

---

## Optional config

Drop a file at `~/.clocked/config.json` to tune the defaults:

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

Everything stays on your machine. All data lives in `~/.clocked/`:

- `events.jsonl` — raw hook events (append-only)
- `activity.json` — processed activity log

No telemetry, no accounts, no cloud.

---

## Built with AI

95%+ of this codebase was written by AI coding agents (mainly Claude Code + Sonnet) — tracked by Clocked AI itself. We're in the best era of software development that has ever existed, and this tool exists to celebrate that.

Go build something.

---

## Why this exists

I couldn't find a tool that just tracks how much time I actually spend building with AI. So I built one. I'll keep working on it as long as I or the community find it useful.

---

## Contributing

Issues and PRs welcome. Be cool.

---

## License

[MIT](LICENSE)
