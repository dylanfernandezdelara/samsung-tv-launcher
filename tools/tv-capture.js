// Frame-perfect footage of the launcher, captured from the TV itself.
// The TV's DevTools screencast only delivers ~6 frames/s, so the whole UI is slowed down
// (CSS/Web Animations through DevTools, the launcher's own timers through its time-scale hook),
// captured, then retimed back to real time at exactly 60 fps.
// Needs ./debug.sh first.  Usage: node tv-capture.js [shot ...]   (no args = all shots)
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');
const { ROOT } = require('./lib');

const SLOW = 30;          // UI runs 30x slower while capturing (every 60 fps frame gets a fresh capture)
const FPS = 60;           // output frame rate
const OUT = path.join(ROOT, 'captures');

// Wallpapers used in the shots (names from launcher/wallpapers/list.js; edit to match yours).
const WP = {
  grey: 'wallpapers/grey-icons.jpg',
  rainbow: 'wallpapers/rainbow-light.jpg',
  green: 'wallpapers/green-icons.jpg'
};

// Shots in real-time seconds. setup runs at normal speed before capture starts.
// Focus only ever moves one tile at a time, like a real remote.
const R = (at) => ({ at, key: 'right' });
const L = (at) => ({ at, key: 'left' });
// n clicks starting at `start`, `gap` seconds apart, with a repeatable human jitter of +-40 ms
let seed = 7;
const jitter = () => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280 - 0.5) * 0.08; };
const run = (start, n, gap, key) => Array.from({ length: n }, (_, i) => ({ at: +(start + i * gap + (i ? jitter() : 0)).toFixed(3), key }));
const SHOTS = {
  // One continuous take for the launch video, paced like a thumb on a remote: unhurried clicks
  // right to the end, quicker clicks back, a wallpaper change at each end of the row. Starts and
  // ends on PlayStation with Grey Icons so it loops. Click times get a fixed +-40 ms jitter.
  take: {
    setup: { wallpaper: WP.grey, focus: 0, clock: '9:41 AM' },
    duration: 12,
    steps: [].concat(
      run(0.9, 6, 0.42, 'right'),
      [{ at: 3.6, wallpaper: WP.rainbow }],
      run(3.9, 6, 0.30, 'left'),
      [{ at: 6.0, wallpaper: WP.green }],
      run(6.3, 6, 0.42, 'right'),
      [{ at: 9.0, wallpaper: WP.grey }],
      run(9.3, 6, 0.30, 'left')
    )
  },
  hook: {
    setup: { wallpaper: WP.grey, focus: 1 },
    duration: 3.2,
    steps: [{ at: 0.7, key: 'right' }, { at: 1.6, key: 'right' }]
  },
  rapid: {
    setup: { wallpaper: WP.grey, focus: 0 },
    duration: 3.4,
    steps: [0.5, 0.65, 0.8, 0.95, 1.1, 1.25].map((at) => ({ at, key: 'right' }))
      .concat([1.75, 1.9, 2.05, 2.2, 2.35, 2.5].map((at) => ({ at, key: 'left' })))
  },
  wallpapers: {
    setup: { wallpaper: WP.grey, focus: 2 },
    duration: 5.6,
    steps: [
      { at: 0.4, wallpaper: WP.rainbow },
      { at: 1.6, key: 'right' },
      { at: 2.9, wallpaper: WP.green },
      { at: 4.1, key: 'left' }
    ]
  },
  rest: {
    setup: { wallpaper: WP.grey, focus: 1 },
    duration: 2.5,
    steps: []
  }
};

const KEYS = { left: [37, 'ArrowLeft'], right: [39, 'ArrowRight'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function target() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9333/json', (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve(JSON.parse(b).find((t) => t.type === 'page').webSocketDebuggerUrl));
    }).on('error', reject);
  });
}

async function connect() {
  const ws = new WebSocket(await target(), { maxPayload: 256 * 1024 * 1024 });
  let id = 0;
  const pending = {};
  const listeners = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending[m.id]) { pending[m.id](m.result || {}); delete pending[m.id]; }
    else listeners.forEach((fn) => fn(m));
  });
  await new Promise((r) => ws.once('open', r));
  const call = (method, params = {}) => new Promise((r) => { const n = ++id; pending[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = (expression) => call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  // one screencast handler at a time, swapped per shot
  let frameHandler = null;
  listeners.push((m) => { if (m.method === 'Page.screencastFrame' && frameHandler) frameHandler(m); });
  return { ws, call, evaluate, onFrame: (fn) => { frameHandler = fn; } };
}

async function key(c, name) {
  const [code, k] = KEYS[name];
  await c.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: k, code: k });
  await c.call('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: k, code: k });
}

async function capture(c, name, shot) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // setup at normal speed, then let everything settle (wallpaper fade is 1.6 s)
  await c.call('Animation.setPlaybackRate', { playbackRate: 1 });
  await c.evaluate('window.__launcher.setTimeScale(1)');
  await c.evaluate(`window.__launcher.showWallpaper(${JSON.stringify(shot.setup.wallpaper)})`);
  await c.evaluate(`window.__launcher.focus(${shot.setup.focus})`);
  await c.evaluate(`window.__launcher.freezeClock(${JSON.stringify(shot.setup.clock || null)})`);
  await sleep(2600);

  // slow everything down and start recording
  await c.evaluate(`window.__launcher.setTimeScale(${SLOW})`);
  await c.call('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
  const frames = [];
  c.onFrame((m) => {
    const n = frames.length;
    const file = `f${String(n).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(m.params.data, 'base64'));
    frames.push({ file, t: m.params.metadata.timestamp });
    c.call('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  });
  await c.call('Page.startScreencast', { format: 'jpeg', quality: 96, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(400);
  const t0 = Date.now() / 1000;
  const log = [];
  for (const step of shot.steps) {
    const wait = t0 + step.at * SLOW - Date.now() / 1000;
    if (wait > 0) await sleep(wait * 1000);
    const real = (Date.now() / 1000 - t0) / SLOW;
    if (step.key) { await key(c, step.key); log.push({ t: +real.toFixed(4), key: step.key }); }
    if (step.wallpaper) { await c.evaluate(`window.__launcher.showWallpaper(${JSON.stringify(step.wallpaper)})`); log.push({ t: +real.toFixed(4), wallpaper: step.wallpaper }); }
  }
  const end = t0 + shot.duration * SLOW - Date.now() / 1000;
  if (end > 0) await sleep(end * 1000);
  await c.call('Page.stopScreencast');
  c.onFrame(null);
  await c.call('Animation.setPlaybackRate', { playbackRate: 1 });
  await c.evaluate('window.__launcher.setTimeScale(1)');
  await sleep(300);

  // retime: each 60 fps output frame shows the newest capture taken at or before that moment
  const list = [];
  let j = 0;
  const total = Math.round(shot.duration * FPS);
  for (let n = 0; n < total; n++) {
    const tReal = n / FPS;
    while (j + 1 < frames.length && (frames[j + 1].t - t0) / SLOW <= tReal) j++;
    list.push(`file '${frames[j].file}'\nduration ${(1 / FPS).toFixed(6)}`);
  }
  list.push(`file '${frames[j].file}'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
  fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify({ shot: name, fps: FPS, duration: shot.duration, events: log }, null, 2));
  const mp4 = path.join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', mp4]);

  const realGaps = frames.slice(1).map((f, i) => (f.t - frames[i].t) / SLOW * 1000).sort((a, b) => a - b);
  return `${name}: ${frames.length} source frames over ${shot.duration}s -> ${total} output frames; ` +
    `median gap ${realGaps[realGaps.length >> 1]?.toFixed(1)} ms, p95 ${realGaps[Math.floor(realGaps.length * 0.95)]?.toFixed(1)} ms (real time) -> ${path.relative(ROOT, mp4)}`;
}

(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
  const c = await connect();
  await c.call('Animation.enable');
  for (const name of names) console.log(await capture(c, name, SHOTS[name]));
  c.ws.close();
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
