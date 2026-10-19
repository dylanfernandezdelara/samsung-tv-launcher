// Shared settings for the tools. Your TV's address lives in tv.json at the repo root (gitignored,
// written by `npm run find-tv`) or in the TV_IP environment variable.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TIZEN = path.join(process.env.HOME, 'tizen-studio/tools/ide/bin/tizen');
const SDB = path.join(process.env.HOME, 'tizen-studio/tools/sdb');

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

module.exports = { ROOT, TIZEN, SDB, settings, appId };

// `node tools/lib.js ip|app|cert` prints a value for shell scripts
if (require.main === module) {
  const what = process.argv[2];
  if (what === 'app') console.log(appId());
  else if (what === 'cert') console.log(settings().certProfile);
  else console.log(settings().ip);
}
