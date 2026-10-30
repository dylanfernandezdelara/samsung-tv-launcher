// Find Samsung TVs on your local network and save the one you pick to tv.json.
// Usage: npm run find-tv            (scans your subnet, up to a /22, for the TV's REST API on port 8001)
//        npm run find-tv -- 192.168.1.50   (check one address)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const OUT = path.join(__dirname, '..', 'tv.json');

function probe(ip) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port: 8001, path: '/api/v2/', timeout: 1500 }, (res) => {
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

const toInt = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const toIp = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');

// Mesh routers (e.g. TP-Link Deco) often hand out a /22 like 192.168.68.0/22, so the TV can sit
// outside this computer's /24. Scan the interface's real subnet, but no wider than a /22.
function subnets() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      // home networks only (192.168.x, 10.x, 172.16-31.x); skips VPN and public interfaces
      if (a.family !== 'IPv4' || a.internal || !/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      const bits = Math.min(30, Math.max(22, Number((a.cidr || '').split('/')[1]) || 24));
      const size = 2 ** (32 - bits);
      const first = Math.floor(toInt(a.address) / size) * size;
      out.push({ mine: a.address, first, size, label: `${toIp(first)}/${bits}` });
    }
  }
  return out;
}
const inNet = (n, ip) => toInt(ip) >= n.first && toInt(ip) < n.first + n.size;

(async () => {
  const one = process.argv[2];
  const nets = subnets();
  const targets = one ? [one] : [...new Set(nets.flatMap((n) => Array.from({ length: n.size - 2 }, (_, i) => toIp(n.first + i + 1))))];
  if (!one && !nets.length) { console.log('No home network found (192.168.x / 10.x / 172.16-31.x). Connect to the same Wi-Fi as the TV, or pass its IP: npm run find-tv -- <ip>'); process.exit(1); }
  if (!one) console.log(`Scanning ${[...new Set(nets.map((n) => n.label))].join(', ')} ...`);
  const found = [];
  // 32 probes in flight: wider sweeps flood ARP and miss a TV that answers a direct probe in ms
  let next = 0;
  await Promise.all(Array.from({ length: 32 }, async () => {
    while (next < targets.length) {
      const t = await probe(targets[next++]);
      // TVs report a model name; Samsung soundbars and other Tizen devices answer with an empty one
      if (t && t.os === 'Tizen' && t.model) found.push(t);
    }
  }));
  found.sort((a, b) => toInt(a.ip) - toInt(b.ip));
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
  fs.writeFileSync(OUT, JSON.stringify({ ...file, ip: tv.ip }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(OUT, 0o600);
  console.log(`Saved ${tv.ip} to tv.json${found.length > 1 ? ' (edit it to pick another)' : ''}.`);
  // the address on the TV's own network is the one to type into Developer Mode
  const host = nets.filter((n) => inNet(n, tv.ip)).map((n) => n.mine);
  if (host.length || nets.length) console.log(`This computer's IP (for the TV's Developer Mode "Host PC IP"): ${(host.length ? host : nets.map((n) => n.mine)).join(' or ')}`);
})();
