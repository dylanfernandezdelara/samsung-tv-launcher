// Drives the TV for phone-filmed takes so before/after use the identical press rhythm.
//   node tv-director.js prep-before   Samsung home, scroll to the bottom row (run while setting up)
//   node tv-director.js take-before   spoken countdown, fast Up then Right presses, "cut"
//   node tv-director.js prep-after    open the launcher on the first tile
//   node tv-director.js take-after    same countdown and rhythm on the launcher
// Each take plays one pre-rendered soundtrack with a soft click at every press (used to sync the
// two clips by press time, never by the screen's response) and writes takes/<name>.json.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ROOT, TIZEN, settings, openRemote, readPairing } = require('./lib');

const TV_IP = settings().ip;
const TOKEN = readPairing().token;
if (!TOKEN) { console.error('Pair first: npm run pair'); process.exit(1); }
const NAME = Buffer.from('TVLauncherSetup').toString('base64');
const OUT = path.join(ROOT, 'takes');
const LEAD = 0.6;           // seconds of silence in the soundtrack before the first press
const GAP = 0.15;           // fast human thumb: ~6.7 presses per second
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The shared rhythm: a burst of 10, a short beat, a burst of 8, then a 3 s hold.
const RHYTHM = [...Array(10)].map((_, i) => i * GAP).concat([...Array(8)].map((_, i) => 10 * GAP + 0.5 + i * GAP));
// Wallpaper names below come from launcher/wallpapers/list.js; edit them to match yours.
// The launcher row has 7 tiles, so the after take moves only between neighbors: a fast run right
// to the end, a fast run back, then unhurried clicks, with a wallpaper change at each end
// (bright wallpapers only, so the screen doesn't mirror the room).
const run = (start, n, gap, key) => [...Array(n)].map((_, i) => ({ t: +(start + i * gap).toFixed(3), key }));
const TAKES = {
  'take-before': RHYTHM.map((t, i) => ({ t, key: i < 10 ? 'KEY_UP' : 'KEY_RIGHT' })),
  'take-after': [].concat(
    run(0, 6, GAP, 'KEY_RIGHT'),
    [{ t: 1.0, wallpaper: 'wallpapers/rainbow-light.jpg' }],
    run(1.4, 6, GAP, 'KEY_LEFT'),
    [{ t: 2.5, wallpaper: 'wallpapers/green-icons.jpg' }],
    run(2.9, 6, 0.42, 'KEY_RIGHT'),
    [{ t: 5.6, wallpaper: 'wallpapers/grey-icons.jpg' }],
    run(5.9, 6, GAP, 'KEY_LEFT')
  )
};
const HOLD = 3;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = openRemote(`wss://${TV_IP}:8002/api/v2/channels/samsung.remote.control?name=${NAME}&token=${TOKEN}`);
    ws.on('message', (raw) => { if (JSON.parse(raw).event === 'ms.channel.connect') resolve(ws); });
    ws.on('error', reject);
  });
}
const press = (ws, key) => ws.send(JSON.stringify({
  method: 'ms.remote.control',
  params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' }
}));
const say = (text) => execFileSync('say', ['-r', '190', text]);
const launcher = (expr) => execFileSync('node', [path.join(__dirname, 'tv-debug.js'), 'eval', expr], { stdio: 'ignore' });

// 48 kHz mono WAV: silence with a short soft tick at each press time.
function soundtrack(times, total) {
  const rate = 48000, n = Math.ceil(total * rate);
  const pcm = new Int16Array(n);
  for (const t of times) {
    const s0 = Math.round((LEAD + t) * rate);
    for (let i = 0; i < rate * 0.05 && s0 + i < n; i++) {
      const x = i / rate;
      pcm[s0 + i] += Math.round(9000 * Math.sin(2 * Math.PI * 2000 * x) * Math.exp(-x * 140));
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + n * 2, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(n * 2, 40);
  const file = path.join(OUT, 'clicks.wav');
  fs.writeFileSync(file, Buffer.concat([header, Buffer.from(pcm.buffer)]));
  return file;
}

async function take(name) {
  fs.mkdirSync(OUT, { recursive: true });
  const steps = TAKES[name];
  const end = steps[steps.length - 1].t;
  const wav = soundtrack(steps.filter((s) => s.key).map((s) => s.t), LEAD + end + 0.5);
  const ws = await connect();
  say('Recording in three, two, one. Go.');
  await sleep(700);
  const player = spawn('afplay', [wav]);
  const t0 = process.hrtime.bigint();
  const log = [];
  for (const s of steps) {
    const due = (LEAD + s.t) * 1e3 - Number(process.hrtime.bigint() - t0) / 1e6;
    if (due > 0) await sleep(due);
    const at = +(Number(process.hrtime.bigint() - t0) / 1e9 - LEAD).toFixed(4);
    if (s.key) { press(ws, s.key); log.push({ t: at, key: s.key }); }
    else { launcher(`window.__launcher.showWallpaper(${JSON.stringify(s.wallpaper)})`); log.push({ t: at, wallpaper: s.wallpaper }); }
  }
  await sleep(HOLD * 1000);
  player.kill();
  say('Cut. You can stop recording.');
  ws.close();
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ take: name, lead: LEAD, gap: GAP, presses: log }, null, 2));
  const late = log.map((p, i) => p.t - steps[i].t);
  console.log(`${name}: ${log.filter((p) => p.key).length} presses, timing error max ${(Math.max(...late.map(Math.abs)) * 1000).toFixed(1)} ms -> takes/${name}.json`);
}

async function prepBefore() {
  const ws = await connect();
  press(ws, 'KEY_HOME');
  await sleep(6000);                  // let the rows and ads load
  for (let i = 0; i < 16; i++) { press(ws, 'KEY_DOWN'); await sleep(700); }
  await sleep(2500);                  // let the bottom rows finish loading
  ws.close();
  console.log('prep-before: on the stock home, scrolled to the bottom');
}

async function prepAfter() {
  // debug launch so the take can change wallpapers on cue
  execFileSync(path.join(__dirname, 'debug.sh'), { stdio: 'ignore' });
  await sleep(4000);
  launcher(`window.__launcher.freezeClock(null)`);
  launcher(`window.__launcher.showWallpaper('wallpapers/grey-icons.jpg')`);
  launcher(`window.__launcher.focus(0)`);
  await sleep(2500);
  console.log('prep-after: launcher open on the first tile, Grey Icons wallpaper');
}

const cmd = process.argv[2];
({ 'prep-before': prepBefore, 'prep-after': prepAfter, 'take-before': () => take('take-before'), 'take-after': () => take('take-after') }[cmd] || (() => { console.error('usage: prep-before | take-before | prep-after | take-after'); process.exit(1); }))()
  .catch((e) => { console.error(e.message); process.exit(1); });
