import * as vscode from 'vscode';
import { Stats, formatFullDuration } from './stats';

export class ClockedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'clocked.view';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._html();

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'resetStats') {
        vscode.commands.executeCommand('clocked.resetStats');
      } else if (msg.command === 'nukeActivity') {
        vscode.commands.executeCommand('clocked.nukeActivity');
      } else if (msg.command === 'toggleMode') {
        vscode.commands.executeCommand('clocked.toggleMode');
      } else if (msg.command === 'setMode') {
        vscode.commands.executeCommand('clocked.setMode', msg.mode);
      } else if (msg.command === 'toggleSection') {
        vscode.commands.executeCommand('clocked.toggleSection', msg.section);
      }
    });
  }

  update(stats: Stats, mode: 'today' | 'reset' | 'alltime', expanded: Set<string>) {
    if (!this._view) return;
    this._view.webview.html = this._html(stats, mode, expanded);
  }

  private _html(
    stats?: Stats,
    mode: 'today' | 'reset' | 'alltime' = 'today',
    expanded = new Set<string>(['since-reset', 'streak', 'settings'])
  ): string {
    const s    = stats;
    const fmtF = (ms: number) => stats ? formatFullDuration(ms) : '—';
    const fmtDate = (iso: string | null): string => {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const isOpen = (id: string) => expanded.has(id);

    // Master accordion (same visual weight as Current Session header)
    const masterSection = (id: string, label: string, content: string, chip = '', tooltip = '') => {
      const open = isOpen(id);
      return `
  <div class="master-accordion">
    <button class="master-acc-header" onclick="toggle('${id}')"${tooltip ? ` title="${tooltip}"` : ''}>
      <span class="master-acc-arrow">${open ? '▾' : '▸'}</span>
      <span class="master-acc-label">${label}</span>
      ${chip ? `<span class="master-acc-chip">${chip}</span>` : ''}
    </button>
    <div class="master-acc-body${open ? '' : ' collapsed'}">${content}</div>
  </div>`;
    };

    // ── Section contents ──────────────────────────────────────────────────────

    const AFK_TOOLTIP = 'Active time — estimated AFK gaps are excluded';

    const sinceResetContent = `
    <div class="stat">
      <span class="stat-value" id="reset-time">${fmtF(s?.activeAiTime ?? 0)}</span>
    </div>`;

    const alltimeContent = `
    <div class="stat">
      <span class="stat-value" id="ever-time">${fmtF(s?.everActiveAiTime ?? 0)}</span>
    </div>`;

    const streakContent = `
    <div class="grid">
      <div class="stat">
        <span class="stat-label">Current</span>
        <span class="stat-value">${s ? `🔥 ${s.currentStreak}d` : '—'}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Best</span>
        <span class="stat-value">${s ? `🏆 ${s.longestStreak}d` : '—'}</span>
      </div>
    </div>`;

    const settingsContent = `
    <div class="setting-row">
      <span class="setting-label">Status bar</span>
      <div class="seg-ctrl">
        <button class="seg-btn${mode === 'today'   ? ' active' : ''}" onclick="vscode.postMessage({command:'setMode',mode:'today'})">🕐</button>
        <button class="seg-btn${mode === 'reset'   ? ' active' : ''}" onclick="vscode.postMessage({command:'setMode',mode:'reset'})">🔄</button>
        <button class="seg-btn${mode === 'alltime' ? ' active' : ''}" onclick="vscode.postMessage({command:'setMode',mode:'alltime'})">🔮</button>
      </div>
    </div>
    <div class="setting-row">
      <span class="setting-label">Reset period</span>
      <button class="btn btn-amber" onclick="vscode.postMessage({command:'resetStats'})">Reset</button>
    </div>
    <div class="setting-row">
      <span class="setting-label">Nuke all data</span>
      <button class="btn btn-red" onclick="vscode.postMessage({command:'nukeActivity'})">Nuke</button>
    </div>`;

    const sinceChip = s?.periodStart ? `since ${fmtDate(s.periodStart)}` : '';
    const everChip  = s?.firstRecorded ? `since ${fmtDate(s.firstRecorded)}` : '';

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 14px 12px 16px;
  }

  /* ── Master section label (shared by Today hero + accordion headers) ── */
  .master-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }

  /* ── Today hero block ── */
  .hero {
    padding-bottom: 10px;
  }
  .hero-descriptor {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 6px;
    margin-bottom: 4px;
  }
  .hero-time-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .hero-time {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .afk-tag {
    font-size: 10px;
    font-style: italic;
    color: rgba(210, 120, 40, 0.65);
    letter-spacing: 0.04em;
  }

  /* ── Sub-accordion (today detail, visually nested under Today hero) ── */
  .sub-accordion {
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    margin-left: 2px;
  }
  .sub-acc-header {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 6px 0;
    text-align: left;
  }
  .sub-acc-label {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    letter-spacing: 0.04em;
  }
  .sub-acc-peek {
    margin-left: auto;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.75;
  }
  .sub-acc-body { padding-bottom: 8px; }
  .sub-acc-body.collapsed { display: none; }

  /* ── Master accordion (All Time, Streak, Settings) ── */
  .master-accordion {
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
    margin-top: 4px;
  }
  .master-acc-header {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 10px 0 8px;
    text-align: left;
  }
  .master-acc-arrow {
    font-size: 9px;
    color: var(--vscode-descriptionForeground);
    width: 10px;
    flex-shrink: 0;
  }
  .master-acc-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .master-acc-chip {
    font-size: 9px;
    font-weight: 400;
    color: var(--vscode-descriptionForeground);
    letter-spacing: 0;
    text-transform: none;
    margin-left: 4px;
    opacity: 0.65;
  }
  .master-acc-body { padding-bottom: 12px; }
  .master-acc-body.collapsed { display: none; }

  /* ── Shared accordion arrow ── */
  .acc-arrow {
    font-size: 9px;
    color: var(--vscode-descriptionForeground);
    width: 10px;
    flex-shrink: 0;
  }

  /* ── Stats grid ── */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat-label {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .stat-value {
    font-size: 17px;
    font-weight: 600;
  }

  /* ── Settings ── */
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .setting-row:last-child { margin-bottom: 0; }
  .setting-label {
    font-size: 11px;
    color: var(--vscode-foreground);
  }
  /* ── Segmented control (status bar mode) ── */
  .seg-ctrl {
    display: flex;
    gap: 2px;
    background: var(--vscode-widget-border, rgba(128,128,128,0.15));
    border-radius: 4px;
    padding: 2px;
  }
  .seg-btn {
    flex: 1;
    padding: 2px 5px;
    background: transparent;
    border: none;
    border-radius: 3px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    white-space: nowrap;
  }
  .seg-btn.active {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }
  .seg-btn:not(.active):hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15));
  }
  .btn {
    padding: 3px 10px;
    border: none;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
  }
  /* Amber — for reset period */
  .btn-amber {
    background: rgba(190, 120, 40, 0.22);
    color: #d4883a;
  }
  .btn-amber:hover { background: rgba(190, 120, 40, 0.38); }
  /* Red — for nuke */
  .btn-red {
    background: rgba(180, 40, 40, 0.22);
    color: #c94f4f;
  }
  .btn-red:hover { background: rgba(180, 40, 40, 0.38); }
</style>
</head>
<body>

  <!-- ── Today hero ───────────────────────────────────────── -->
  <div class="hero">
    <div class="master-label">🕐 Today</div>
    <div class="hero-descriptor" title="${AFK_TOOLTIP}">Building actively with AI for</div>
    <div class="hero-time-row">
      <div class="hero-time" id="hero-time">${fmtF(s?.todayActiveAiTime ?? 0)}</div>
      ${s && !s.isAiActive ? `<span class="afk-tag">AFK</span>` : ''}
    </div>
  </div>


  <!-- ── Period + ever master sections ──────────────────── -->
  ${masterSection('since-reset', '🔄 Since Reset', sinceResetContent, sinceChip)}
  ${masterSection('alltime', '🔮 All Time', alltimeContent, everChip)}
  ${masterSection('streak', '🔥 Building Streak', streakContent, '', 'At least 1 hour of building with AI per day keeps the streak alive!')}
  ${masterSection('settings', '⚙️ Settings', settingsContent)}

<script>
  const vscode = acquireVsCodeApi();
  function toggle(id) {
    vscode.postMessage({ command: 'toggleSection', section: id });
  }

  // Live ticker — only runs while Claude is mid-response (isAiActive), self-corrects on re-render
  const IS_AI_ACTIVE    = ${s?.isAiActive ?? false};
  const TICK_BASE_TS    = Date.now();
  const TODAY_BASE_MS   = ${s?.todayActiveAiTime ?? 0};
  const RESET_BASE_MS   = ${s?.activeAiTime ?? 0};
  const EVER_BASE_MS    = ${s?.everActiveAiTime ?? 0};

  function fmtFull(ms) {
    const totalSec  = Math.floor(ms / 1000);
    const sec       = totalSec % 60;
    const totalMin  = Math.floor(totalSec / 60);
    const min       = totalMin % 60;
    const totalHr   = Math.floor(totalMin / 60);
    const hr        = totalHr % 24;
    const totalDays = Math.floor(totalHr / 24);
    const day       = totalDays % 30;
    const mo        = Math.floor(totalDays / 30);
    const parts = [];
    if (mo  > 0)                   parts.push(mo  + 'mo');
    if (day > 0 || mo > 0)         parts.push(day + 'd');
    if (hr  > 0 || day > 0 || mo > 0) parts.push(hr + 'h');
    parts.push(min + 'm');
    parts.push(sec + 's');
    return parts.join(' ');
  }

  function tick() {
    if (!IS_AI_ACTIVE) return;
    const elapsed = Date.now() - TICK_BASE_TS;
    const hero  = document.getElementById('hero-time');
    const reset = document.getElementById('reset-time');
    const ever  = document.getElementById('ever-time');
    if (hero)  hero.textContent  = fmtFull(TODAY_BASE_MS + elapsed);
    if (reset) reset.textContent = fmtFull(RESET_BASE_MS + elapsed);
    if (ever)  ever.textContent  = fmtFull(EVER_BASE_MS  + elapsed);
  }
  tick();
  setInterval(tick, 1000);
</script>
</body>
</html>`;
  }
}
