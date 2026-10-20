// Checks every setup step in order and says what to do next. Safe to run any time.
// Usage: npm run doctor        (agents: run it after each step in AGENTS.md)
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, TIZEN, SDB, appId, readPairing } = require('./lib');

const results = [];
const check = (ok, step, pass, fix) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}: ${ok ? pass : fix}`); return ok; };
const skip = (step, why) => console.log(`SKIP  ${step}: ${why}`);
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return null; } };

function get(ip, p) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port: 8001, path: p, timeout: 1500 }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function portOpen(ip, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port, timeout: 1500 }, () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}

(async () => {
  check(+process.versions.node.split('.')[0] >= 18, 'Node', process.version, `Node 18+ needed (have ${process.version})`);

  const mine = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);

  const ip = process.env.TV_IP || (read('tv.json') || {}).ip;
  if (!check(Boolean(ip), '1. Find the TV', `tv.json has ${ip}`, 'run `npm run find-tv`')) return done();

  const info = await get(ip, '/api/v2/');
  const d = info && info.device;
  if (!check(Boolean(d), '1. TV reachable', `${d && d.modelName} on port 8001`, `nothing answers at ${ip}:8001; is the TV on and on this Wi-Fi? Rerun \`npm run find-tv\``)) return done();
  const sameNet = mine.filter((a) => a.split('.').slice(0, 3).join('.') === ip.split('.').slice(0, 3).join('.'));

  let paired = false, pairingError = '';
  try { paired = Boolean(readPairing().token); } catch (e) { pairingError = e.message; }
  check(paired, '2. Paired', 'tv-token.json has a token', pairingError || 'run `npm run pair` and have the person press Allow on the TV');

  const devOn = d.developerMode === '1';
  const devOk = devOn && sameNet.includes(d.developerIP);
  check(devOk, '3. Developer Mode', `on, host ${d.developerIP}`,
    devOn ? `on, but host is ${d.developerIP}; it must be this computer: ${sameNet.join(' or ') || mine.join(' or ')}`
      : `off; turn it on with host IP ${sameNet.join(' or ') || mine.join(' or ')} (AGENTS.md step 3)`);

  if (devOk) check(await portOpen(ip, 26101), '4. Full restart', 'port 26101 open', 'port 26101 closed; the person unplugs the TV for 60 s (power button only sleeps it)');
  else skip('4. Full restart', 'needs Developer Mode first');

  const tools = fs.existsSync(TIZEN) && fs.existsSync(SDB);
  check(tools, '5. Tizen tools', path.resolve(TIZEN, '../../../..'), `missing ${TIZEN} or ${SDB}; install them (README step 1, ask the person first)`);

  if (tools) {
    let profiles = '';
    try { profiles = execFileSync(TIZEN, ['security-profiles', 'list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {}
    const name = process.env.CERT_PROFILE || (read('tv.json') || {}).certProfile || 'tv';
    check(profiles.split(/\s+/).includes(name), '6. Certificate', `profile "${name}"`, `no profile "${name}"; open Certificate Manager for the person (AGENTS.md step 6)`);
  } else skip('6. Certificate', 'needs Tizen tools first');

  const app = await get(ip, `/api/v2/applications/${appId()}`);
  check(Boolean(app && app.running), '9. Launcher', `${appId()} running${app && app.visible ? ' and on screen' : ''}`,
    app ? 'installed but not running; open it from the TV\'s Apps' : 'not installed; run `npm run deploy`');
  done();
})();

function done() {
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} to fix. Fix the first FAIL, then run \`npm run doctor\` again.` : '\nAll set.');
  process.exitCode = failed ? 1 : 0;
}
