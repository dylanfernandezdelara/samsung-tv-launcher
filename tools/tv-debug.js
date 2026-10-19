// Talk to the launcher's DevTools on the TV (needs `./debug.sh` first to forward port 9333).
// Usage:
//   node tv-debug.js eval "<js expression>"
//   node tv-debug.js shot out.png
//   node tv-debug.js logs [seconds]      (console output + errors, also reloads the page)
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.DEVTOOLS_PORT || 9333;
const [cmd, arg] = process.argv.slice(2);

function target() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        const page = JSON.parse(body).find((t) => t.type === 'page');
        page ? resolve(page.webSocketDebuggerUrl) : reject(new Error('no page target'));
      });
    }).on('error', reject);
  });
}

(async () => {
  const ws = new WebSocket(await target());
  let id = 0;
  const pending = {};
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending[n] = { resolve, reject };
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending[msg.id]) {
      msg.error ? pending[msg.id].reject(new Error(msg.error.message)) : pending[msg.id].resolve(msg.result);
      delete pending[msg.id];
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      console.log(`[${msg.params.type}]`, msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.log('[exception]', d.exception?.description || d.text, `${d.url || ''}:${d.lineNumber}`);
    } else if (msg.method === 'Log.entryAdded') {
      console.log(`[log:${msg.params.entry.level}]`, msg.params.entry.text, msg.params.entry.url || '');
    }
  });
  await new Promise((r) => ws.once('open', r));

  if (cmd === 'eval') {
    const res = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) console.error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    else console.log(typeof res.result.value === 'string' ? res.result.value : JSON.stringify(res.result.value, null, 2));
  } else if (cmd === 'shot') {
    const res = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(arg || 'tv-shot.png', Buffer.from(res.data, 'base64'));
    console.log('saved', arg || 'tv-shot.png');
  } else if (cmd === 'logs') {
    await call('Runtime.enable');
    await call('Log.enable');
    await call('Page.reload');
    await new Promise((r) => setTimeout(r, (Number(arg) || 6) * 1000));
  } else {
    console.error('usage: eval <expr> | shot <file> | logs [seconds]');
  }
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
