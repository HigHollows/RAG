'use strict';
// Génère build/icon.png (512x512) sans dépendance : carré arrondi dégradé + mini-graphe.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const S = 512;
const px = Buffer.alloc(S * S * 4);
const nodes = [[150, 170, 46], [372, 150, 36], [260, 350, 54], [120, 380, 24], [400, 380, 26]];
const edges = [[0, 1], [0, 2], [1, 2], [2, 3], [2, 4]];
const seg = (x, y, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
};
const rr = (x, y, r) => {
  const q = [Math.abs(x - S / 2) - (S / 2 - 8 - r), Math.abs(y - S / 2) - (S / 2 - 8 - r)];
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0)) + Math.min(Math.max(q[0], q[1]), 0) - r;
};
const aa = (d) => Math.max(0, Math.min(1, 0.5 - d));
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = (y * S + x) * 4;
  const m = aa(rr(x + 0.5, y + 0.5, 110));
  const t = (x + y) / (2 * S);
  let c = [79 + (139 - 79) * (1 - t) * 0.6 - 10 * t, 70 + 20 * (1 - t), 229 - 50 * t];
  let a = 0;
  for (const [p, q] of edges) a = Math.max(a, aa(seg(x + 0.5, y + 0.5, nodes[p], nodes[q]) - 7));
  for (const [nx, ny, r] of nodes) a = Math.max(a, aa(Math.hypot(x + 0.5 - nx, y + 0.5 - ny) - r));
  c = c.map((v) => v * (1 - a) + 255 * a);
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = Math.round(m * 255);
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(path.join(__dirname, 'icon.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log('build/icon.png écrit');
