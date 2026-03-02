import * as fs   from 'fs';
import * as os   from 'os';
import * as path from 'path';

/**
 * Optional user config file: ~/.clocked/config.json
 *
 * All fields are optional — omit any to keep the default.
 *
 * {
 *   "afkThresholdMin":    20,   // minutes of inactivity after a Stop before the session closes
 *   "streakThresholdMin": 60,   // minutes of active AI time needed in a day to count toward streak
 *   "refreshIntervalSec": 5     // how often activity.json is re-read and the panel is refreshed
 * }
 */
interface UserConfig {
  afkThresholdMin?:    number;
  streakThresholdMin?: number;
  refreshIntervalSec?: number;
}

function loadUserConfig(): UserConfig {
  const cfgPath = path.join(os.homedir(), '.clocked', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as UserConfig;
  } catch {
    return {}; // file missing or malformed — use all defaults
  }
}

const MIN = 60_000;
const cfg = loadUserConfig();

// Grace window after a Stop event before the activity is considered closed.
// Raise this if you take long pauses between prompts that should still count as one session.
export const AFK_THRESHOLD_MS    = (cfg.afkThresholdMin    ?? 20) * MIN;

// Minimum active AI time per calendar day required to keep a building streak alive.
export const STREAK_MIN_MS       = (cfg.streakThresholdMin ?? 60) * MIN;

// How often the extension processes new events and refreshes the sidebar panel.
// Lower = more responsive; higher = lighter on I/O.
export const REFRESH_INTERVAL_MS = (cfg.refreshIntervalSec ??  5) * 1_000;
