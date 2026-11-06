const fs = require('fs');
const edit = (f, pairs) => { let s = fs.readFileSync(f, 'utf8'); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(f + ' introuvable: ' + a.slice(0, 60)); s = s.replace(a, b); } fs.writeFileSync(f, s); };

// sources.js : PDF page par page avec repli OCR, images
let s = fs.readFileSync('src/core/sources.js', 'utf8');
const i = s.indexOf('async function pdfToText(buf) {');
const j = s.indexOf('/** @returns {Promise<{raw:string, kind:string}>} */');
s = s.slice(0, i) + `const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

async function pdfToText(buf, ocr = {}) {
  let unpdf;
  try {
    unpdf = await import('unpdf');
  } catch {
    throw new Error('Lecture PDF indisponible (module unpdf absent)');
  }
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(buf));
  const { text } = await unpdf.extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((t) => t.trim());
  const empty = pages.map((t, k) => (t.length < 20 ? k : -1)).filter((k) => k >= 0);
  let ocrCount = 0;
  if (empty.length && ocr.enabled) {
    const O = require('./ocr');
    for (const k of empty.slice(0, ocr.maxPages || 300)) {
      try {
        pages[k] = await O.ocrImage(await O.renderPage(pdf, k + 1, ocr.scale || 2), ocr.languages || 'fra+eng');
        if (pages[k].length >= 20) ocrCount++;
      } catch (e) {
        if (ocrCount === 0 && empty.length === pages.length) throw new Error('OCR indisponible : ' + e.message);
      }
    }
  }
  const joined = pages.map((t, k) => '## Page ' + (k + 1) + '\n' + t).filter((x) => x.length > 14 + 8).join('\n\n');
  if (!joined.trim()) throw new Error(ocr.enabled ? 'Aucun texte détecté, même par OCR' : 'PDF sans texte extractible (activez l’OCR dans Réglages)');
  return { raw: joined, ocrPages: ocrCount };
}

async function imageToText(file, title, ocr = {}) {
  if (!ocr.enabled || !ocr.images) throw new Error('Image ignorée (OCR des images désactivé)');
  const text = await require('./ocr').ocrImage(fs.readFileSync(file), ocr.languages || 'fra+eng');
  if (text.length < 10) throw new Error('Aucun texte détecté dans l’image');
  return '# ' + title + '\n\n' + text;
}

` + s.slice(j);
s = s.replace('async function readSource(vault, rel) {', 'async function readSource(vault, rel, opts = {}) {');
s = s.replace("if (ext === '.pdf') return { raw: await pdfToText(fs.readFileSync(file)), kind: 'pdf' };",
  "if (ext === '.pdf') { const r = await pdfToText(fs.readFileSync(file), opts.ocr); return { raw: r.raw, kind: r.ocrPages ? 'pdf-ocr' : 'pdf' }; }\n  if (IMAGE_EXT.includes(ext)) return { raw: await imageToText(file, title, opts.ocr), kind: 'image-ocr' };");
s = s.replace('module.exports = { readSource,', 'module.exports = { IMAGE_EXT, readSource,');
fs.writeFileSync('src/core/sources.js', s);

edit('src/core/config.js', [["  auto: {", "  ocr: { enabled: true, images: false, languages: 'fra+eng', maxPages: 300, scale: 2 },\n  auto: {"]]);

edit('src/core/ingest.js', [
  ["const { readSource } = require('./sources');", "const { readSource, IMAGE_EXT } = require('./sources');"],
  ["      const files = O.listFiles(v);", "      const files = O.listFiles({ ...v, extensions: [...(v.extensions || ['.md', '.txt', '.pdf', '.csv', '.json']), ...(this.cfg.ocr.enabled && this.cfg.ocr.images ? IMAGE_EXT : [])] });"],
  ["        const { raw } = await readSource(f.vault, f.rel);\n        const note", "        const { raw } = await readSource(f.vault, f.rel, { ocr: { enabled: false } });\n        const note"],
  ["    const { raw, kind } = await readSource(f.vault, f.rel);", "    const { raw, kind } = await readSource(f.vault, f.rel, { ocr: this.cfg.ocr });"],
  ["      this._running = false;\n", "      this._running = false;\n      await require('./ocr').terminate();\n"],
]);

edit('src/ui/app.js', [
  ["  const httpOn = h('input'", "  const ocrOn = h('input', { type: 'checkbox', checked: cfg.ocr.enabled }), ocrImg = h('input', { type: 'checkbox', checked: cfg.ocr.images });\n  const ocrLang = h('select', null, [['fra+eng', 'Français + anglais'], ['fra', 'Français'], ['eng', 'Anglais']].map(([v, l]) => h('option', { value: v, selected: cfg.ocr.languages === v }, l)));\n  const httpOn = h('input'"],
  ["auto: { watch: wOn.checked,", "ocr: { enabled: ocrOn.checked, images: ocrImg.checked, languages: ocrLang.value }, auto: { watch: wOn.checked,"],
  ["    h('div', { class: 'card' }, h('h2', null, 'Automatisation'),", "    h('div', { class: 'card' }, h('h2', null, 'Reconnaissance de texte (OCR)'),\n      h('label', { class: 'row' }, ocrOn, 'Lire les pages de PDF scannés'),\n      h('label', { class: 'row', style: 'margin-top:8px' }, ocrImg, 'Lire aussi les images du coffre (PNG, JPG) — plus long'),\n      h('label', { class: 'field' }, h('span', null, 'Langues'), ocrLang),\n      h('p', { class: 'small muted' }, 'Traitement entièrement local : aucune image n’est envoyée à l’extérieur. Les données de langue sont incluses dans l’application.')),\n    h('div', { class: 'card' }, h('h2', null, 'Automatisation'),"],
]);
