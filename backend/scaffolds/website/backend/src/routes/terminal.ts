import { Router } from 'express';

import { deviceBaseUrl } from '../config/deviceEndpoints.js';
import { getDeviceInfo } from '../services/deviceClient.js';
import {
  pushTerminalLine,
  recentTerminalLines,
  subscribeTerminal,
  type TerminalLine,
} from '../services/terminalLog.js';

/**
 * The browser terminal — the dashboard's own terminal, open in the browser
 * itself.
 *
 *   GET  /terminal                    zero-dependency terminal page (SSE tail)
 *   GET  /api/terminal/stream         live line stream (text/event-stream)
 *   POST /api/terminal/probe          ping the device now, log the answer
 *
 * The page is served from the same origin the server landed on — whichever
 * port it actually bound — so it works no matter how the port was chosen.
 * There is no shell here on purpose: the one action a device terminal needs
 * (re-probe the hardware) is a fixed route. Nothing is remote-executed.
 */
export function terminalRouter(): Router {
  const router = Router();

  router.get('/api/terminal/stream', (req, res) => {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const since = Number(req.query.since ?? 0);
    for (const line of recentTerminalLines(Number.isFinite(since) ? since : 0)) {
      res.write(sseLine(line));
    }
    const unsubscribe = subscribeTerminal((line) => res.write(sseLine(line)));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  router.post('/api/terminal/probe', async (_req, res) => {
    pushTerminalLine('device', 'probing ' + deviceBaseUrl() + ' …');
    try {
      const info = await getDeviceInfo();
      pushTerminalLine('device', 'device answered: ' + JSON.stringify(info));
      res.json({ ok: true, info });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushTerminalLine('error', 'probe failed: ' + message);
      res.status(502).json({ ok: false, error: message });
    }
  });

  router.get('/terminal', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(terminalPage(deviceBaseUrl()));
  });

  return router;
}

function sseLine(line: TerminalLine): string {
  return 'data: ' + JSON.stringify(line) + '\n\n';
}

/**
 * The terminal page, assembled from plain strings (no client-side framework,
 * no build step, no external assets). Built with an array + join so nothing
 * in the embedded script needs escaping.
 */
function terminalPage(deviceTarget: string): string {
  const safeTarget = deviceTarget.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const head = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>Device terminal</title>',
    '<style>',
    ':root { color-scheme: dark; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; background: #0b0f14; color: #d7e2ea; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; height: 100vh; display: flex; flex-direction: column; }',
    'header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #1d2a36; background: #0e141b; }',
    'header h1 { font-size: 12px; letter-spacing: 2px; margin: 0; color: #7fd1a8; }',
    '.target { color: #6b7f8f; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.state { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #1d2a36; color: #6b7f8f; }',
    '.state.live { color: #7fd1a8; border-color: #245a41; }',
    '.state.dead { color: #e2726e; border-color: #5a2424; }',
    'button { font: inherit; font-size: 11px; background: #12202c; color: #d7e2ea; border: 1px solid #24435a; border-radius: 6px; padding: 4px 10px; cursor: pointer; }',
    'button:hover { background: #172a39; }',
    'button:disabled { opacity: 0.5; cursor: default; }',
    'main { flex: 1; overflow-y: auto; padding: 10px 14px; }',
    '.ln { white-space: pre-wrap; word-break: break-word; }',
    '.ln .at { color: #4d6273; margin-right: 10px; }',
    '.ln.boot { color: #e5c07b; }',
    '.ln.request { color: #8296a5; }',
    '.ln.device { color: #7fd1a8; }',
    '.ln.control { color: #61afef; }',
    '.ln.error { color: #e2726e; }',
    'footer { padding: 6px 14px; border-top: 1px solid #1d2a36; color: #4d6273; font-size: 11px; }',
    '</style>',
    '</head>',
    '<body>',
    '<header>',
    '<h1>DEVICE TERMINAL</h1>',
    '<span class="target" id="target"></span>',
    '<span class="state" id="state">connecting…</span>',
    '<button id="probe" type="button">Ping device</button>',
    '<button id="clear" type="button">Clear</button>',
    '</header>',
    '<main id="term" role="log" aria-live="polite"></main>',
    '<footer>Live feed of this dashboard\'s API traffic and device probes. The server picked its own port at boot — this page is served from that same origin.</footer>',
    '<script data-device="' + safeTarget + '">',
    'var term = document.getElementById("term");',
    'var state = document.getElementById("state");',
    'var deviceTag = document.querySelector("script[data-device]");',
    'document.getElementById("target").textContent = "target: " + (deviceTag ? deviceTag.getAttribute("data-device") : "device");',
    'var lastSeq = 0;',
    'function addLine(line) {',
    '  if (!line || typeof line !== "object") return;',
    '  if (typeof line.seq === "number") lastSeq = Math.max(lastSeq, line.seq);',
    '  var row = document.createElement("div");',
    '  row.className = "ln " + (line.kind || "info");',
    '  var at = document.createElement("span");',
    '  at.className = "at";',
    '  at.textContent = line.at || "";',
    '  var tx = document.createElement("span");',
    '  tx.textContent = line.text || "";',
    '  row.appendChild(at);',
    '  row.appendChild(tx);',
    '  var stick = term.scrollHeight - term.scrollTop - term.clientHeight < 48;',
    '  term.appendChild(row);',
    '  if (stick) term.scrollTop = term.scrollHeight;',
    '}',
    'function connect() {',
    '  var es = new EventSource("/api/terminal/stream?since=" + lastSeq);',
    '  es.onopen = function () { state.textContent = "live"; state.className = "state live"; };',
    '  es.onmessage = function (event) {',
    '    try { addLine(JSON.parse(event.data)); } catch (e) { /* keep-alive comment or bad frame */ }',
    '  };',
    '  es.onerror = function () {',
    '    state.textContent = "reconnecting…";',
    '    state.className = "state dead";',
    '    es.close();',
    '    setTimeout(connect, 1500);',
    '  };',
    '}',
    'document.getElementById("probe").addEventListener("click", function () {',
    '  var btn = this;',
    '  btn.disabled = true;',
    '  fetch("/api/terminal/probe", { method: "POST" }).finally(function () { btn.disabled = false; });',
    '});',
    'document.getElementById("clear").addEventListener("click", function () { term.replaceChildren(); });',
    'connect();',
    '</script>',
    '</body>',
    '</html>',
  ];
  return head.join('\n');
}
