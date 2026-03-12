# Changelog

## v0.0.3

- Add AI Labor section with cumulative total (Steam-style hours)
- Track per-session response times: ⚡ current, ⏳ longest, 🏗️ total
- Live-tick all timers per second while AI is responding
- Persist pending_prompts in activity.json across refresh cycles
- Eliminate double activity.json disk read (processEvents returns ActivityFile)
- Session stats left-aligned, 2-slot time format (Xh Ym or Ym Zs)
- Tooltip improvements across all session stats

## v0.0.2

- Add sessions panel with live/standby/closed session tracking
- Rename "Since Reset" to "Checkpoint"
- Add manual AFK button (⏸) to immediately close current activity
- Fix phantom activity bug
- Fix install script: macOS mktemp compat, fixed temp path, keep .vsix on failure, accurate done message

## v0.0.1

- Initial release
- Track active AI building time: Today, Checkpoint, All Time
- Building streak (consecutive days with 1+ hour of AI time)
- AFK detection with 20-minute grace window
- Status bar with live-ticking timer
- One-command install script
- Claude Code hooks integration (SessionStart, SessionEnd, UserPromptSubmit, Stop)
