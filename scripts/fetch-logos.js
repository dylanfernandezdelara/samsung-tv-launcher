// Download the apps' official vector logos from Wikimedia Commons into launcher/img/, recolored
// for their tiles (white on brand color, the way the brands use them on colored backgrounds).
// Logos are trademarks of their owners; they are fetched to your machine, not shipped in this repo.
// Usage: npm run logos
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const OUT = path.join(__dirname, '..', 'launcher', 'img');

// file on Commons -> output name + recolor step
const LOGOS = [
  { commons: 'PlayStation_logo.svg', out: 'logo-playstation.svg', fix: (s) => s.replace(/fill:#1f1f1f/g, 'fill:#ffffff') },
  { commons: 'Netflix_2015_logo.svg', out: 'logo-netflix.svg', fix: (s) => s },
  { commons: 'Disney+_logo.svg', out: 'logo-disneyplus.svg', fix: (s) => s.replace(/fill="#01147c"/g, 'fill="#ffffff"').replace(/stop-color="#[0-9a-fA-F]{6}"/g, 'stop-color="#ffffff"') },
  { commons: 'Prime_Video_logo_(2024).svg', out: 'logo-primevideo.svg', fix: (s) => s.replace(/fill="#0779ff"/g, 'fill="#ffffff"') },
  { commons: 'YouTube_2024.svg', out: 'logo-youtube.svg', fix: (s) => s.replace('<svg', '<svg fill="#ffffff"') },
  { commons: '2024_Spotify_Logo.svg', out: 'logo-spotify.svg', fix: (s) => s.replace(/#1ed760/gi, '#000000') },
  { commons: 'Instagram_simple_icon.svg', out: 'logo-instagram.svg', fix: (s) => s.replace(/fill:#000000/g, 'fill:#ffffff') }
];

// Commons file URLs are /x/xy/Name where xy are the first hex digits of md5(Name).
function commonsUrl(name) {
  const h = crypto.createHash('md5').update(name).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(name)}`;
}

function get(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'tv-launcher-setup/1.0 (personal use)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode === 429 && redirects) {   // rate limited: wait as asked, then retry
        res.resume();
        const wait = Math.min(30, Number(res.headers['retry-after']) || 10) * 1000;
        return setTimeout(() => resolve(get(url, redirects - 1)), wait);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

// TV browsers need an intrinsic size: set width/height on the root <svg> from its viewBox.
function sized(svg, width = 1000) {
  const tag = /<svg\b[^>]*>/s.exec(svg)[0];
  const [, , vw, vh] = /viewBox="([\d.\s-]+)"/.exec(tag)[1].trim().split(/\s+/).map(Number);
  const clean = tag.replace(/\s(width|height)="[^"]*"/g, '');
  return svg.replace(tag, clean.replace('<svg', `<svg width="${width}" height="${Math.round((width * vh) / vw)}"`));
}

// Only plain vector markup: no scripts, styles, event handlers, embedded images or HTML, or
// external references of any kind.
function safe(svg) {
  return !/<script|<style|<foreignObject|<image|\son\w+\s*=|@import|url\(|(xlink:)?href\s*=\s*["']?\s*(https?:|\/\/)/i.test(svg);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let ok = 0;
  for (const l of LOGOS) {
    try {
      const svg = await get(commonsUrl(l.commons));
      if (!safe(svg)) throw new Error('unexpected content, skipped');
      fs.writeFileSync(path.join(OUT, l.out), sized(l.fix(svg)));
      console.log(`  ok  ${l.out}`);
      ok++;
    } catch (e) {
      console.log(`  --  ${l.out}: ${e.message} (the tile falls back to drawn art)`);
    }
    await new Promise((r) => setTimeout(r, 3000));   // be polite to Wikimedia
  }
  console.log(`${ok}/${LOGOS.length} logos in launcher/img/`);
})();
