import * as vscode from 'vscode';
import { Stats, formatFullDuration } from './stats';
import type { LiveSession } from './extension';

export class ClockedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'clocked.view';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._html();

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'resetCheckpoint') {
        vscode.commands.executeCommand('clocked.resetCheckpoint');
      } else if (msg.command === 'nukeActivity') {
        vscode.commands.executeCommand('clocked.nukeActivity');
      } else if (msg.command === 'toggleMode') {
        vscode.commands.executeCommand('clocked.toggleMode');
      } else if (msg.command === 'setMode') {
        vscode.commands.executeCommand('clocked.setMode', msg.mode);
      } else if (msg.command === 'clearClosedSessions') {
        vscode.commands.executeCommand('clocked.clearClosedSessions');
      } else if (msg.command === 'toggleSection') {
        vscode.commands.executeCommand('clocked.toggleSection', msg.section);
      }
    });
  }

  update(stats: Stats, mode: 'today' | 'checkpoint' | 'alltime', expanded: Set<string>, sessions?: Map<string, LiveSession>) {
    if (!this._view) return;
    this._view.webview.html = this._html(stats, mode, expanded, sessions);
  }

  private _html(
    stats?: Stats,
    mode: 'today' | 'checkpoint' | 'alltime' = 'today',
    expanded = new Set<string>(['checkpoint', 'alltime', 'streak', 'settings']),
    sessions?: Map<string, LiveSession>,
  ): string {
    const s    = stats;
    const fmtF = (ms: number) => stats ? formatFullDuration(ms) : '—';
    const fmtDate = (iso: string | null): string => {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const isOpen = (id: string) => expanded.has(id);

    // Master accordion (same visual weight as Current Session header)
    const masterSection = (id: string, label: string, content: string, chip = '', tooltip = '', action = '') => {
      const open = isOpen(id);
      return `
  <div class="master-accordion">
    <div class="master-acc-row">
      <button class="master-acc-header" onclick="toggle('${id}')"${tooltip ? ` title="${tooltip}"` : ''}>
        <span class="master-acc-arrow">${open ? '▾' : '▸'}</span>
        <span class="master-acc-label">${label}</span>
        ${chip ? `<span class="master-acc-chip">${chip}</span>` : ''}
      </button>
      ${action}
    </div>
    <div class="master-acc-body${open ? '' : ' collapsed'}">${content}</div>
  </div>`;
    };

    // ── Section contents ──────────────────────────────────────────────────────

    const AFK_TOOLTIP = 'Active time — estimated AFK gaps are excluded';

    const checkpointContent = `
    <div class="stat">
      <span class="stat-value" id="checkpoint-time">${fmtF(s?.checkpointAiTime ?? 0)}</span>
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
        <button class="seg-btn${mode === 'checkpoint'   ? ' active' : ''}" onclick="vscode.postMessage({command:'setMode',mode:'checkpoint'})">🔄</button>
        <button class="seg-btn${mode === 'alltime' ? ' active' : ''}" onclick="vscode.postMessage({command:'setMode',mode:'alltime'})">🔮</button>
      </div>
    </div>
    <div class="setting-row">
      <span class="setting-label">Reset checkpoint</span>
      <button class="btn btn-amber" onclick="vscode.postMessage({command:'resetCheckpoint'})">Reset</button>
    </div>
    <div class="setting-row">
      <span class="setting-label">Nuke all data</span>
      <button class="btn btn-red" onclick="vscode.postMessage({command:'nukeActivity'})">Nuke</button>
    </div>`;

    const checkpointChip = s?.checkpointStart ? `since ${fmtDate(s.checkpointStart)}` : '';
    const everChip  = s?.firstRecorded ? `since ${fmtDate(s.firstRecorded)}` : '';

    // ── Sessions content ───────────────────────────────────────────────────────
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtShort = (ms: number) => {
      const sec = Math.floor(ms / 1000) % 60;
      const min = Math.floor(ms / 60000) % 60;
      const hr  = Math.floor(ms / 3600000);
      return hr > 0 ? `${hr}h ${min}m ${sec}s` : min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    };
    const sessionList = sessions ? Array.from(sessions.entries()) : [];
    const liveCount = sessionList.filter(([, s]) => !s.closed).length;
    const closedCount = sessionList.length - liveCount;
    const sessionsChip = sessionList.length > 0 ? `${liveCount} live · ${sessionList.length} total` : '';
    const clearClosedBtn = closedCount > 0
      ? `<button class="session-clear-closed" title="Remove all closed sessions" onclick="vscode.postMessage({command:'clearClosedSessions'})">🧹</button>`
      : '';
    const sessionsContent = sessionList.length === 0
      ? `<div class="session-empty">No sessions yet</div>`
      : sessionList.map(([id, sess]) => {
          const shortId = id.slice(0, 8);
          const liveDot = sess.isResponding ? '<span class="live-dot"></span>' : '';
          const lastResp = sess.isResponding && sess.promptTs
            ? `<span class="session-stat session-live-timer" data-prompt-ts="${sess.promptTs}" title="Current AI response time">⚡ ${fmtShort(Date.now() - sess.promptTs)}</span>`
            : sess.lastResponseMs !== null
              ? `<span class="session-stat" title="Last AI response time">⚡ ${fmtShort(sess.lastResponseMs)}</span>`
              : `<span class="session-stat" title="Last AI response time">⚡ —</span>`;
          const longest = sess.longestResponseMs > 0
            ? `<span class="session-stat" title="Longest AI response time">⏱ ${fmtShort(sess.longestResponseMs)}</span>`
            : `<span class="session-stat" title="Longest AI response time">⏱ —</span>`;
          const rowClass = sess.isResponding ? ' session-responding' : sess.closed ? ' session-closed' : ' session-standby';
          return `
      <div class="session-row${rowClass}">
        <div class="session-header">
          ${liveDot}
          <span class="session-id">${shortId}</span>
        </div>
        <div class="session-stats">
          ${lastResp}
          <span class="session-sep">&middot;</span>
          ${longest}
        </div>
      </div>`;
        }).join('');

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

  /* ── Master accordion (All Time, Streak, Settings) ── */
  .master-accordion {
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
    margin-top: 4px;
  }
  .master-acc-row {
    display: flex;
    align-items: center;
  }
  .master-acc-header {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1;
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
  /* Amber — for checkpoint reset */
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

  /* ── Sessions ── */
  .session-empty {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    padding: 4px 0;
  }
  .session-row {
    padding: 6px 0;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1));
  }
  .session-row:last-child { border-bottom: none; }
  .session-responding {
    border-left: 2px solid #4ec9b0;
    padding-left: 8px;
  }
  .session-standby {
    padding-left: 10px;
  }
  .session-closed {
    padding-left: 10px;
  }
  .session-closed .session-id {
    color: rgba(180, 40, 40, 0.7);
  }
  .session-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ec9b0;
    flex-shrink: 0;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .session-id {
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-descriptionForeground);
  }
  .session-clear-closed {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.5;
    padding: 0 2px;
    vertical-align: middle;
  }
  .session-clear-closed:hover { opacity: 1; }
  .session-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
    padding-left: 12px;
  }
  .session-stat {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
  }
  .session-sep {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.5;
  }
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
  ${masterSection('checkpoint', '🔄 Checkpoint', checkpointContent, checkpointChip)}
  ${masterSection('alltime', '🔮 All Time', alltimeContent, everChip)}
  ${masterSection('streak', '🔥 Building Streak', streakContent, '', 'At least 1 hour of building with AI per day keeps the streak alive!')}
  ${masterSection('sessions', '📋 Sessions', sessionsContent, sessionsChip, '', clearClosedBtn)}
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
  const CHECKPOINT_BASE_MS   = ${s?.checkpointAiTime ?? 0};
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

  function fmtShort(ms) {
    const sec = Math.floor(ms / 1000) % 60;
    const min = Math.floor(ms / 60000) % 60;
    const hr  = Math.floor(ms / 3600000);
    return hr > 0 ? hr + 'h ' + min + 'm ' + sec + 's' : min > 0 ? min + 'm ' + sec + 's' : sec + 's';
  }

  function tick() {
    const now = Date.now();
    // Aggregate time tickers
    if (IS_AI_ACTIVE) {
      const elapsed = now - TICK_BASE_TS;
      const hero  = document.getElementById('hero-time');
      const reset = document.getElementById('checkpoint-time');
      const ever  = document.getElementById('ever-time');
      if (hero)  hero.textContent  = fmtFull(TODAY_BASE_MS + elapsed);
      if (reset) reset.textContent = fmtFull(CHECKPOINT_BASE_MS + elapsed);
      if (ever)  ever.textContent  = fmtFull(EVER_BASE_MS  + elapsed);
    }
    // Session live response timers
    document.querySelectorAll('.session-live-timer').forEach(el => {
      const ts = Number(el.getAttribute('data-prompt-ts'));
      if (ts) el.textContent = '⚡ ' + fmtShort(now - ts);
    });
  }
  tick();
  setInterval(tick, 1000);
</script>
</body>
</html>`;
  }
}
