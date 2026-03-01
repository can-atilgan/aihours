'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.aihours');
const LOG = path.join(DIR, 'events.jsonl');

fs.mkdirSync(DIR, { recursive: true });

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw);

    const event      = payload.hook_event_name;
    const session_id = payload.session_id;
    const cwd        = payload.cwd;
    const tool       = payload.tool_name || null;

    let meta = null;
    if (event === 'SessionStart' && payload.source) meta = { source: payload.source };
    if (event === 'SessionEnd'   && payload.reason) meta = { reason: payload.reason };

    const line = JSON.stringify({ ts: new Date().toISOString(), event, session_id, cwd, tool, meta });
    fs.appendFileSync(LOG, line + '\n');
  } catch (_) {
    // never fail — must not interrupt Claude
  }
  process.exit(0);
});
