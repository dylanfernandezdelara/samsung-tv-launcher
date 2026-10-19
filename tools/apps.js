// List the apps installed on the TV with their ids, for `match` in launcher/config.js.
// Usage: npm run apps [filter]     e.g. npm run apps -- netflix
const { execFileSync } = require('child_process');
const { SDB, settings } = require('./lib');

const tv = `${settings().ip}:26101`;
execFileSync(SDB, ['connect', settings().ip], { stdio: 'ignore' });
const out = execFileSync(SDB, ['-s', tv, 'shell', '0', 'applist'], { encoding: 'utf8' });
const filter = (process.argv[2] || '').toLowerCase();

// Store apps have random 10-character package ids (e.g. "MCmYXNxgcu.DisneyPlus"); a few big
// apps ship built in (org.tizen.netflix-app, org.tizen.primevideo).
const STORE = /^(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]{10}\./;
const BUILT_IN = /^org\.tizen\.(netflix-app|primevideo|browser)$/;
const SYSTEM = /service|widget|preview|cmsWebApp|WebAccount|CastSettings|emanual|ePop|Launcher/i;
const rows = [...out.matchAll(/'([^']*)'\s+'([^']+)'/g)]
  .map(([, name, id]) => ({ name, id }))
  .filter((a) => a.name && (STORE.test(a.id) || BUILT_IN.test(a.id)))
  .filter((a) => !SYSTEM.test(a.name + ' ' + a.id))
  .filter((a) => !filter || (a.name + a.id).toLowerCase().includes(filter));

for (const a of rows) console.log(`  ${a.name.padEnd(34)} ${a.id}`);
if (!rows.length) console.log('No matching apps. (Without a filter this lists store apps and a few built-ins.)');
