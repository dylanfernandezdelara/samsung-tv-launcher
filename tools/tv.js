// Send remote keys to the TV over its Wi-Fi remote API (port 8002).
// Usage: node tools/tv.js KEY_1 KEY_2 ...   (no keys = just pair; the TV shows an "Allow" prompt once)
// Handy for remotes without number buttons, e.g. Developer Mode: open Apps > App Settings, then
//   node tools/tv.js KEY_1 KEY_2 KEY_3 KEY_4 KEY_5
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { ROOT, settings } = require('./lib');

const TV_IP = settings().ip;
const NAME = Buffer.from('TVLauncherSetup').toString('base64');
const TOKEN_FILE = path.join(ROOT, 'tv-token.json');   // gitignored
const KEY_DELAY_MS = Number(process.env.KEY_DELAY_MS || 600);
const HOLD = process.env.HOLD === '1'; // send Press/Release pairs instead of Click
const HOLD_MS = Number(process.env.HOLD_MS || 250);

const keys = process.argv.slice(2);
const savedToken = fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token : '';

let url = `wss://${TV_IP}:8002/api/v2/channels/samsung.remote.control?name=${NAME}`;
if (savedToken) url += `&token=${savedToken}`;

const ws = new WebSocket(url, { rejectUnauthorized: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const timeout = setTimeout(() => {
  console.error('Timed out waiting for the TV. If an "Allow" prompt is showing on the TV, accept it and run again.');
  process.exit(1);
}, 45000);

ws.on('message', async (raw) => {
  const msg = JSON.parse(raw);
  if (msg.event === 'ms.channel.unauthorized') {
    console.error('TV rejected the connection (Allow was denied, or this device is blocked in TV settings).');
    process.exit(1);
  }
  if (msg.event !== 'ms.channel.connect') return;
  clearTimeout(timeout);

  const token = msg.data && msg.data.token;
  if (token && token !== savedToken) {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2));
    console.log('Paired; token saved to tv-token.json');
  } else {
    console.log('Connected');
  }

  const send = (cmd, key) => ws.send(JSON.stringify({
    method: 'ms.remote.control',
    params: { Cmd: cmd, DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
  }));

  for (const key of keys) {
    if (HOLD) {
      send('Press', key);
      await sleep(HOLD_MS);
      send('Release', key);
    } else {
      send('Click', key);
    }
    console.log(`Sent ${key}`);
    await sleep(KEY_DELAY_MS);
  }
  ws.close();
});

ws.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});
