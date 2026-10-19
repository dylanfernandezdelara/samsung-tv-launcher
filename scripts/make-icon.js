// Writes a 512x423 PNG: dark rounded-feel tile with a row of three white dots.
const fs = require('fs'), zlib = require('zlib');
const W = 512, H = 423, out = process.argv[2];
const raw = Buffer.alloc((W * 4 + 1) * H);
const dots = [[176, 211], [256, 211], [336, 211]];
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const t = (x + y) / (W + H);
    let r = 40 - 22 * t, g = 44 - 24 * t, b = 58 - 30 * t;
    for (const [cx, cy] of dots) {
      const d = Math.hypot(x - cx, y - cy);
      const a = Math.max(0, Math.min(1, 26 - d));
      r += (255 - r) * a; g += (255 - g) * a; b += (255 - b) * a;
    }
    const i = y * (W * 4 + 1) + 1 + x * 4;
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
