import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { calcStats, appendEvent, formatDuration } from './stats';
import { processEvents } from './activityProcessor';
import { ClockedViewProvider } from './provider';
import { REFRESH_INTERVAL_MS } from './config';

const LOG_DIR  = path.join(os.homedir(), '.clocked');
const LOG_FILE = path.join(LOG_DIR, 'events.jsonl');
const CWD      = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();

// ── In-memory session tracking ──────────────────────────────────────────────

export interface LiveSession {
  project:            string;
  startedAt:          number;       // ms — when session first seen
  promptTs:           number | null; // ms — when current response started
  lastResponseMs:     number | null; // frozen duration of last completed response
  longestResponseMs:  number;       // high-water mark
  isResponding:       boolean;
}

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  const bar = vscode.window.createStatusBarItem('clocked.bar', vscode.StatusBarAlignment.Right, 100);
  bar.name    = 'Clocked AI';
  bar.command = 'clocked.openPanel';
  bar.show();
  context.subscriptions.push(bar);

  // Sidebar provider
  const provider = new ClockedViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('clocked.view', provider)
  );

  // Open panel command — focuses our view in the secondary sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('clocked.openPanel', () => {
      vscode.commands.executeCommand('clocked.view.focus');
    })
  );

  // Status bar display mode — persisted, default 'today'
  let statusMode = context.globalState.get<'today' | 'reset' | 'alltime'>('statusMode', 'today');

  // Persistent accordion expansion state
  const defaultExpanded = ['since-reset', 'alltime', 'streak', 'settings'];
  const expandedSections = new Set<string>(
    context.globalState.get<string[]>('expandedSections', defaultExpanded)
  );

  // ── In-memory session tracking (no persistence, no file scanning) ──────────
  const sessions = new Map<string, LiveSession>();
  let sessionBytes = 0;

  function readSessionEvents() {
    if (!fs.existsSync(LOG_FILE)) return;
    const size = fs.statSync(LOG_FILE).size;
    if (size <= sessionBytes) {
      if (size < sessionBytes) { sessions.clear(); sessionBytes = 0; } // file truncated (nuke)
      return;
    }
    const fd  = fs.openSync(LOG_FILE, 'r');
    const buf = Buffer.alloc(size - sessionBytes);
    fs.readSync(fd, buf, 0, buf.length, sessionBytes);
    fs.closeSync(fd);
    sessionBytes = size;

    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        const { session_id, event, cwd, ts } = ev;
        if (!session_id) continue;
        const evMs = +new Date(ts);

        if (event === 'UserPromptSubmit') {
          let sess = sessions.get(session_id);
          if (!sess) {
            sess = { project: path.basename(cwd) || cwd, startedAt: evMs, promptTs: null, lastResponseMs: null, longestResponseMs: 0, isResponding: false };
            sessions.set(session_id, sess);
          }
          // If was responding without a Stop, treat as interrupted
          if (sess.isResponding && sess.promptTs) {
            const elapsed = evMs - sess.promptTs;
            sess.lastResponseMs = elapsed;
            if (elapsed > sess.longestResponseMs) sess.longestResponseMs = elapsed;
          }
          sess.promptTs = evMs;
          sess.isResponding = true;
        }

        if (event === 'Stop' || event === 'SessionEnd') {
          const sess = sessions.get(session_id);
          if (sess && sess.isResponding && sess.promptTs) {
            const elapsed = evMs - sess.promptTs;
            sess.lastResponseMs = elapsed;
            if (elapsed > sess.longestResponseMs) sess.longestResponseMs = elapsed;
            sess.isResponding = false;
          }
        }
      } catch { /* skip malformed lines */ }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('clocked.toggleMode', () => {
      statusMode = statusMode === 'today' ? 'reset' : statusMode === 'reset' ? 'alltime' : 'today';
      context.globalState.update('statusMode', statusMode);
      update();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clocked.setMode', (m: 'today' | 'reset' | 'alltime') => {
      statusMode = m;
      context.globalState.update('statusMode', statusMode);
      update();
    })
  );

  // Toggle accordion section and persist to globalState
  context.subscriptions.push(
    vscode.commands.registerCommand('clocked.toggleSection', (section: string) => {
      if (expandedSections.has(section)) {
        expandedSections.delete(section);
      } else {
        expandedSections.add(section);
      }
      context.globalState.update('expandedSections', Array.from(expandedSections));
      update();
    })
  );

  // Reset all-time stats command
  context.subscriptions.push(
    vscode.commands.registerCommand('clocked.resetStats', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all Clocked AI stats? This cannot be undone.',
        { modal: true },
        'Reset'
      );
      if (confirm === 'Reset') {
        try {
          appendEvent({ event: 'StatsReset', cwd: CWD });
          processEvents();
          update();
          vscode.window.showInformationMessage('Clocked AI stats reset. History preserved.');
        } catch {
          vscode.window.showErrorMessage('Failed to reset stats.');
        }
      }
    })
  );

  // Nuke all activity data command
  context.subscriptions.push(
    vscode.commands.registerCommand('clocked.nukeActivity', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Type "nuke" to permanently delete all activity data',
        placeHolder: 'nuke',
        ignoreFocusOut: true,
      });
      if (input !== 'nuke') return;
      try {
        const activityPath = path.join(LOG_DIR, 'activity.json');
        if (fs.existsSync(LOG_FILE))     fs.unlinkSync(LOG_FILE);
        if (fs.existsSync(activityPath)) fs.unlinkSync(activityPath);
        sessions.clear();
        sessionBytes = 0;
        processEvents();
        update();
        vscode.window.showInformationMessage('All Clocked AI data nuked.');
      } catch {
        vscode.window.showErrorMessage('Failed to nuke activity data.');
      }
    })
  );

  // ── Stats update ─────────────────────────────────────────────────────────────

  // Bar tick state — set by update(), consumed by tickBar() every second
  let barIcon     = '🕐';
  let barBaseMs   = 0;
  let barBaseTs   = 0;
  let barIsLive   = false;
  let barStreak   = 0;
  let barTooltip  = 'Today — click to cycle mode';

  function tickBar() {
    const ms = barIsLive ? barBaseMs + (Date.now() - barBaseTs) : barBaseMs;
    const time = formatDuration(ms);
    bar.text    = barStreak > 0 ? `${barIcon} ${time} · 🔥${barStreak}` : `${barIcon} ${time}`;
    bar.tooltip = barTooltip;
  }

  function update() {
    try {
      readSessionEvents();
      const stats = calcStats();
      const [icon, ms, tooltip] =
        statusMode === 'today' ? ['🕐', stats.todayActiveAiTime, 'Clocked today. Click to expand.'] :
        statusMode === 'reset' ? ['🔄', stats.activeAiTime,      'Clocked since reset. Click to expand.'] :
                                 ['🔮', stats.everActiveAiTime,  'Clocked all time. Click to expand.'];
      barIcon    = icon;
      barBaseMs  = ms;
      barBaseTs  = Date.now();
      barIsLive  = stats.isAiActive;
      barStreak  = stats.currentStreak;
      barTooltip = tooltip;
      tickBar();
      provider.update(stats, statusMode, expandedSections, sessions);
    } catch {
      bar.text = '🕐 Clocked AI';
    }
  }

  // ── File watcher ─────────────────────────────────────────────────────────────

  fs.mkdirSync(LOG_DIR, { recursive: true });
  let fsWatcher: fs.FSWatcher | undefined;
  function startWatcher() {
    if (!fs.existsSync(LOG_FILE)) { setTimeout(startWatcher, 2000); return; }
    fsWatcher = fs.watch(LOG_FILE, () => { try { processEvents(); } catch {} update(); });
  }
  startWatcher();

  // 5s: processEvents + full stats recalc
  const timer = setInterval(() => { try { processEvents(); } catch {} update(); }, REFRESH_INTERVAL_MS);
  // 1s: lightweight bar tick (pure arithmetic, no I/O)
  const barTimer = setInterval(tickBar, 1_000);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer);
      clearInterval(barTimer);
      fsWatcher?.close();
    }
  });

  try { processEvents(); } catch {}
  update();
}

export function deactivate() {}
