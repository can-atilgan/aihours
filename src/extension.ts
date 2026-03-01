import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { calcStats, appendEvent, formatDuration } from './stats';
import { processEvents } from './activityProcessor';
import { AiHoursViewProvider } from './provider';
import { REFRESH_INTERVAL_MS } from './config';

const LOG_DIR  = path.join(os.homedir(), '.aihours');
const LOG_FILE = path.join(LOG_DIR, 'events.jsonl');
const CWD      = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  const bar = vscode.window.createStatusBarItem('aihours.bar', vscode.StatusBarAlignment.Right, 100);
  bar.name    = 'AI Hours';
  bar.command = 'aihours.openPanel';
  bar.show();
  context.subscriptions.push(bar);

  // Sidebar provider
  const provider = new AiHoursViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aihours.view', provider)
  );

  // Open panel command — focuses our view in the secondary sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('aihours.openPanel', () => {
      vscode.commands.executeCommand('aihours.view.focus');
    })
  );

  // Status bar display mode — persisted, default 'today'
  let statusMode = context.globalState.get<'today' | 'reset' | 'alltime'>('statusMode', 'today');

  // Persistent accordion expansion state
  const defaultExpanded = ['since-reset', 'streak', 'settings'];
  const expandedSections = new Set<string>(
    context.globalState.get<string[]>('expandedSections', defaultExpanded)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aihours.toggleMode', () => {
      statusMode = statusMode === 'today' ? 'reset' : statusMode === 'reset' ? 'alltime' : 'today';
      context.globalState.update('statusMode', statusMode);
      update();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aihours.setMode', (m: 'today' | 'reset' | 'alltime') => {
      statusMode = m;
      context.globalState.update('statusMode', statusMode);
      update();
    })
  );

  // Toggle accordion section and persist to globalState
  context.subscriptions.push(
    vscode.commands.registerCommand('aihours.toggleSection', (section: string) => {
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
    vscode.commands.registerCommand('aihours.resetStats', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all AI Hours stats? This cannot be undone.',
        { modal: true },
        'Reset'
      );
      if (confirm === 'Reset') {
        try {
          appendEvent({ event: 'StatsReset', cwd: CWD });
          processEvents();
          update();
          vscode.window.showInformationMessage('AI Hours stats reset. History preserved.');
        } catch {
          vscode.window.showErrorMessage('Failed to reset stats.');
        }
      }
    })
  );

  // Nuke all activity data command
  context.subscriptions.push(
    vscode.commands.registerCommand('aihours.nukeActivity', async () => {
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
        processEvents();
        update();
        vscode.window.showInformationMessage('All AI Hours data nuked.');
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
      const stats = calcStats();
      const [icon, ms, tooltip] =
        statusMode === 'today' ? ['🕐', stats.todayActiveAiTime, 'AI Hours today. Click to expand.'] :
        statusMode === 'reset' ? ['🔄', stats.activeAiTime,      'AI Hours since reset. Click to expand.'] :
                                 ['🔮', stats.everActiveAiTime,  'AI Hours all time. Click to expand.'];
      barIcon    = icon;
      barBaseMs  = ms;
      barBaseTs  = Date.now();
      barIsLive  = stats.isAiActive;
      barStreak  = stats.currentStreak;
      barTooltip = tooltip;
      tickBar();
      provider.update(stats, statusMode, expandedSections);
    } catch {
      bar.text = '🕐 AI Hours';
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
