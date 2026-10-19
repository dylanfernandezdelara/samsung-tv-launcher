// On-TV test pass for the launcher. Needs ./debug.sh first (DevTools on localhost:9333).
// Usage: node tv-test.js [scenario ...]   (no args = all)
// Scenarios: keys, hold, mash, wallpaper, idle, startup, double (double relaunches; run it last)
const http = require('http');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');
const { TIZEN, settings, appId } = require('./lib');

const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const remote = (...keys) => execFileSync('node', [__dirname + '/tv.js', ...keys], { env: { ...process.env, KEY_DELAY_MS: '250' } });
const runLauncher = () => execFileSync(TIZEN, ['run', '-s', `${settings().ip}:26101`, '-p', appId()], { stdio: 'ignore' });

function target() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json`, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve(JSON.parse(b).find((t) => t.type === 'page').webSocketDebuggerUrl));
    }).on('error', reject);
  });
}

async function connect() {
  const ws = new WebSocket(await target());
  let id = 0;
  const pending = {};
  const errors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await new Promise((r) => ws.once('open', r));
  const call = (method, params = {}) => new Promise((r) => { const n = ++id; pending[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expr) => {
    const res = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description);
    return res.result.result.value;
  };
  await call('Runtime.enable');
  return { ws, call, evaluate, errors };
}

const KEYS = { left: [37, 'ArrowLeft'], right: [39, 'ArrowRight'], up: [38, 'ArrowUp'], down: [40, 'ArrowDown'], enter: [13, 'Enter'] };
async function key(c, name, repeat = false) {
  const [code, k] = KEYS[name];
  await c.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: k, code: k, autoRepeat: repeat });
  if (!repeat) await c.call('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: k, code: k });
}

const FRAMES_START = `(() => { window.__f = { d: [], last: performance.now(), on: true };
  const loop = (t) => { const f = window.__f; if (!f.on) return; f.d.push(t - f.last); f.last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop); return true; })()`;
const FRAMES_STOP = `(() => { const f = window.__f; f.on = false; const d = f.d.slice(3).sort((a, b) => a - b);
  const q = (p) => d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1) : null;
  return { frames: d.length, p50: q(0.5), p95: q(0.95), max: q(0.9999), janky: d.filter((x) => x > 34).length }; })()`;
const STATE = `(() => { const f = document.querySelector('#row .tile.focus'); const tiles = [...document.querySelectorAll('#row .tile')];
  return { hidden: document.hidden, focus: tiles.indexOf(f), tiles: tiles.length, veil: document.getElementById('veil').className,
    toast: document.getElementById('toast').className.includes('on') ? document.getElementById('toast').textContent : '' }; })()`;

const ORDER = ['startup', 'keys', 'hold', 'mash', 'wallpaper', 'idle', 'double'];
const scenarios = {
  // Every remote button the launcher doesn't use should leave it exactly as it was.
  async keys(c) {
    const out = [];
    for (const k of ['KEY_UP', 'KEY_DOWN', 'KEY_RETURN', 'KEY_1', 'KEY_RED', 'KEY_PLAY', 'KEY_PAUSE', 'KEY_INFO']) {
      const before = await c.evaluate(STATE);
      remote(k);
      await sleep(900);
      const after = await c.evaluate(STATE);
      const ok = !after.hidden && after.focus === before.focus && after.tiles === before.tiles && after.veil.includes('open') && !after.toast;
      out.push(`${ok ? 'PASS' : 'FAIL'} ${k}${ok ? '' : ' ' + JSON.stringify(after)}`);
    }
    return out.join('\n');
  },

  // Holding a direction auto-repeats at ~30 Hz; it should stay at 60fps and stop cleanly at the ends.
  async hold(c) {
    await c.evaluate(FRAMES_START);
    for (let i = 0; i < 40; i++) { await key(c, 'right', i > 0); await sleep(33); }
    const end = await c.evaluate(STATE);
    for (let i = 0; i < 40; i++) { await key(c, 'left', i > 0); await sleep(33); }
    const start = await c.evaluate(STATE);
    const f = await c.evaluate(FRAMES_STOP);
    return `focus after hold right: ${end.focus} (want ${end.tiles - 1}), after hold left: ${start.focus} (want 0)\nframes ${JSON.stringify(f)}`;
  },

  // Alternating left/right as fast as the input queue allows.
  async mash(c) {
    await c.evaluate(FRAMES_START);
    for (let i = 0; i < 60; i++) { await key(c, i % 2 ? 'left' : 'right'); await sleep(25); }
    await sleep(600);
    return `frames ${JSON.stringify(await c.evaluate(FRAMES_STOP))}`;
  },

  // Enter, Enter, Left within 150ms: one launch, focus must not move, launcher must come back clean.
  async double(c0) {
    let c = c0;
    for (let i = 0; i < 9; i++) await key(c, 'right');   // second-to-last tile
    await key(c, 'left');
    await sleep(600);
    const before = await c.evaluate(STATE);
    await key(c, 'enter'); await sleep(60); await key(c, 'enter'); await sleep(60); await key(c, 'left');
    await sleep(3500);
    const during = await c.evaluate(STATE);
    runLauncher();
    await sleep(2500);
    // the relaunch can replace the page target, so reconnect before checking
    try { c.ws.close(); } catch (e) {}
    c = await connect();
    const after = await c.evaluate(STATE);
    await c.evaluate(FRAMES_START);
    await sleep(1200);
    const f = await c.evaluate(FRAMES_STOP);
    return [
      `${during.hidden ? 'PASS' : 'FAIL'} app opened (launcher hidden: ${during.hidden})`,
      `${after.focus === before.focus ? 'PASS' : 'FAIL'} focus kept through double Enter + Left (${before.focus} -> ${after.focus})`,
      `${!after.hidden && after.veil.includes('open') ? 'PASS' : 'FAIL'} launcher back and visible after return (${JSON.stringify(after)})`,
      `return entrance frames ${JSON.stringify(f)}`
    ].join('\n');
  },

  // Trigger the real timed wallpaper change while navigating.
  async wallpaper(c) {
    await c.evaluate(FRAMES_START);
    await c.evaluate('window.__launcher.nextWallpaper(), true');
    for (let i = 0; i < 30; i++) { await key(c, i % 6 < 3 ? 'right' : 'left'); await sleep(80); }
    await sleep(1800);
    return `frames during wallpaper swap + navigation ${JSON.stringify(await c.evaluate(FRAMES_STOP))}`;
  },

  // Diagnostics: crossfade only the wallpaper layers, only the frost, or both (images already
  // decoded and on the GPU), while navigating.
  async xfade(c) {
    const out = [];
    for (const which of ['wp', 'frost', 'both']) {
      await c.evaluate(FRAMES_START);
      await c.evaluate(`(() => { const sel = ${JSON.stringify(which)};
        const groups = sel === 'both' ? ['#art .wp', '#dock .frost'] : [sel === 'wp' ? '#art .wp' : '#dock .frost'];
        groups.forEach((g) => document.querySelectorAll(g).forEach((n) => n.classList.toggle('on'))); return true; })()`);
      for (let i = 0; i < 24; i++) { await key(c, i % 6 < 3 ? 'right' : 'left'); await sleep(80); }
      await sleep(400);
      out.push(which + ' ' + JSON.stringify(await c.evaluate(FRAMES_STOP)));
      await sleep(1500);
    }
    return out.join('\n');
  },

  // Sitting still: the idle float runs; frames should stay steady and memory flat.
  async idle(c) {
    const heap0 = await c.evaluate('performance.memory ? performance.memory.usedJSHeapSize : 0');
    await c.evaluate(FRAMES_START);
    await sleep(15000);
    const f = await c.evaluate(FRAMES_STOP);
    const heap1 = await c.evaluate('performance.memory ? performance.memory.usedJSHeapSize : 0');
    return `idle 15s frames ${JSON.stringify(f)}\nJS heap ${(heap0 / 1e6).toFixed(1)}MB -> ${(heap1 / 1e6).toFixed(1)}MB`;
  },

  // Time from page start to the dock being ready (launcher-ready mark), from a fresh launch.
  async startup(c) {
    const t = await c.evaluate(`(() => { const m = performance.getEntriesByName('launcher-ready')[0];
      const p = performance.getEntriesByType('paint').map((e) => e.name + ' ' + e.startTime.toFixed(0) + 'ms').join(', ');
      return (m ? 'dock ready ' + m.startTime.toFixed(0) + 'ms' : 'no ready mark') + ' | ' + p; })()`);
    return t;
  }
};

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : ORDER;
  let c = await connect();
  for (const name of which) {
    const result = await scenarios[name](c);
    console.log(`\n== ${name}\n${result}`);
  }
  console.log(`\n== errors during run: ${c.errors.length ? c.errors.join(' | ') : 'none'}`);
  c.ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
