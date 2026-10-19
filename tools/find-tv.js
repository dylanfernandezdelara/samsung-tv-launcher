// Find Samsung TVs on your local network and save the one you pick to tv.json.
// Usage: npm run find-tv            (scans your /24 subnet for the TV's REST API on port 8001)
//        npm run find-tv -- 192.168.1.50   (check one address)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const OUT = path.join(__dirname, '..', 'tv.json');

function probe(ip) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port: 8001, path: '/api/v2/', timeout: 800 }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try {
          const d = JSON.parse(b).device;
          resolve({ ip, name: d.name.replace(/&quot;/g, '"'), model: d.modelName, os: d.OS, devMode: d.developerMode === '1', devIP: d.developerIP, power: d.PowerState });
        } catch (e) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function subnets() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      // home networks only (192.168.x, 10.x, 172.16-31.x); skips VPN and public interfaces
      if (a.family === 'IPv4' && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push({ mine: a.address, base: a.address.split('.').slice(0, 3).join('.') });
    }
  }
  return out;
}

(async () => {
  const one = process.argv[2];
  const nets = subnets();
  const targets = one ? [one] : nets.flatMap((n) => Array.from({ length: 254 }, (_, i) => `${n.base}.${i + 1}`));
  if (!one && !nets.length) { console.log('No home network found (192.168.x / 10.x / 172.16-31.x). Connect to the same Wi-Fi as the TV, or pass its IP: npm run find-tv -- <ip>'); process.exit(1); }
  if (!one) console.log(`Scanning ${nets.map((n) => n.base + '.0/24').join(', ')} ...`);
  const found = [];
  for (let i = 0; i < targets.length; i += 64) {
    const batch = await Promise.all(targets.slice(i, i + 64).map(probe));
    // TVs report a model name; Samsung soundbars and other Tizen devices answer with an empty one
    found.push(...batch.filter((t) => t && t.os === 'Tizen' && t.model));
  }
  if (!found.length) {
    console.log('No Samsung TV found. Is the TV on and on the same Wi-Fi as this computer?');
    process.exit(1);
  }
  for (const t of found) {
    console.log(`  ${t.ip}  ${t.name}  (${t.model})  developer mode: ${t.devMode ? 'on, host ' + t.devIP : 'off'}`);
  }
  const tv = found[0];
  let file = {};
  try { file = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
  fs.writeFileSync(OUT, JSON.stringify({ ...file, ip: tv.ip }, null, 2) + '\n');
  console.log(`Saved ${tv.ip} to tv.json${found.length > 1 ? ' (edit it to pick another)' : ''}.`);
  if (nets.length) console.log(`This computer's IP (for the TV's Developer Mode "Host PC IP"): ${nets.map((n) => n.mine).join(' or ')}`);
})();
