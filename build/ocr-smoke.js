// Test manuel : génère une image de texte et un PDF scanné, puis lance l'OCR. Usage : node build/ocr-smoke.js
const fs = require('fs'), os = require('os'), path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { readSource } = require('../src/core/sources');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  const c = createCanvas(900, 300); const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 300); x.fillStyle = '#000'; x.font = '34px sans-serif';
  x.fillText('Le Projet Phoenix est dirigé par Claire Dubois.', 30, 90);
  x.fillText('Réunion du 12 mars : migration vers Nordtech.', 30, 170);
  const png = c.toBuffer('image/png'); const jpg = c.toBuffer('image/jpeg', 90);
  fs.writeFileSync(path.join(dir, 'scan.png'), png);
  // PDF « scanné » : une page contenant uniquement une image JPEG
  const objs = [];
  const add = (b) => objs.push(b);
  add(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'));
  add(Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  add(Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 300] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>'));
  const content = 'q 900 0 0 300 0 0 cm /Im0 Do Q';
  add(Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 900 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, Buffer.from('\nendstream')]));
  let out = Buffer.from('%PDF-1.4\n'); const off = [];
  objs.forEach((o, i) => { off.push(out.length); out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); });
  const xr = out.length;
  out = Buffer.concat([out, Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`)]);
  fs.writeFileSync(path.join(dir, 'scan.pdf'), out);
  console.log('DIR', dir);
  const ocr = { enabled: true, images: true, languages: 'fra+eng', maxPages: 5, scale: 2 };
  let t = Date.now();
  console.log('PDF :', JSON.stringify(await readSource({ path: dir }, 'scan.pdf', { ocr })), (Date.now() - t) + ' ms');
  t = Date.now();
  console.log('PNG :', JSON.stringify(await readSource({ path: dir }, 'scan.png', { ocr })), (Date.now() - t) + ' ms');
  try { await readSource({ path: dir }, 'scan.pdf', { ocr: { enabled: false } }); } catch (e) { console.log('OCR off :', e.message); }
  await require('../src/core/ocr').terminate();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
