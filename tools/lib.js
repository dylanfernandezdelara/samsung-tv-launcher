// Shared settings for the tools. Your TV's address lives in tv.json at the repo root (gitignored,
// written by `npm run find-tv`) or in the TV_IP environment variable.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Tizen Studio lives in ~/tizen-studio unless TIZEN_STUDIO points elsewhere
const STUDIO = process.env.TIZEN_STUDIO || path.join(os.homedir(), 'tizen-studio');
const TIZEN = path.join(STUDIO, 'tools/ide/bin/tizen');
const SDB = path.join(STUDIO, 'tools/sdb');

function settings() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'tv.json'), 'utf8')); } catch (e) {}
  const ip = process.env.TV_IP || file.ip;
  if (!ip) {
    console.error('No TV address. Run `npm run find-tv` (or set TV_IP).');
    process.exit(1);
  }
  return { ip, certProfile: process.env.CERT_PROFILE || file.certProfile || 'tv' };
}

// App id from launcher/config.xml, e.g. "TVLauncher.Launcher"
function appId() {
  const xml = fs.readFileSync(path.join(ROOT, 'launcher/config.xml'), 'utf8');
  return /<tizen:application id="([^"]+)"/.exec(xml)[1];
}

// Pairing with the TV: its token, and the fingerprint of its certificate. Readable only by you.
const PAIRING = process.env.TV_TOKEN_FILE || path.join(ROOT, 'tv-token.json');
// A missing file means not paired yet. A broken one is an error, so the certificate check
// never quietly starts over.
function readPairing() {
  let text;
  try { text = fs.readFileSync(PAIRING, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  try { return JSON.parse(text); } catch (e) { throw new Error(`${PAIRING} is unreadable. Delete it and pair again (npm run pair).`); }
}
function savePairing(update) {
  fs.writeFileSync(PAIRING, JSON.stringify({ ...readPairing(), ...update }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(PAIRING, 0o600);
}

// Opens the TV's remote-control WebSocket. The TV's certificate is self-signed, so it can't be
// checked the usual way. Instead its fingerprint is saved the first time and must match after
// that. The check runs before the request (which carries the token) is sent.
function openRemote(url) {
  const WebSocket = require('ws');
  const tls = require('tls');
  return new WebSocket(url, {
    createConnection(opts, done) {
      const socket = tls.connect({ host: opts.host, port: opts.port, rejectUnauthorized: false });
      socket.once('error', done);
      socket.once('secureConnect', () => {
        const fp = socket.getPeerCertificate().fingerprint256;
        let saved;
        try { saved = readPairing().fp; } catch (e) { socket.destroy(); return done(e); }
        if (saved && saved !== fp) {
          socket.destroy();
          return done(new Error('The TV\'s certificate changed. If you replaced the TV, delete tv-token.json and pair again.'));
        }
        if (!saved) savePairing({ fp });
        done(null, socket);
      });
    }
  });
}

module.exports = { ROOT, TIZEN, SDB, settings, appId, readPairing, savePairing, openRemote };

// `node tools/lib.js ip|app|cert|sdb|tizen` prints a value for shell scripts
if (require.main === module) {
  const what = process.argv[2];
  if (what === 'app') console.log(appId());
  else if (what === 'sdb') console.log(SDB);
  else if (what === 'tizen') console.log(TIZEN);
  else if (what === 'cert') console.log(settings().certProfile);
  else console.log(settings().ip);
}
