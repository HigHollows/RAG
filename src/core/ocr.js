'use strict';
// OCR local (Tesseract, WASM) : images et pages de PDF scannés. Les données de langue sont embarquées,
// rien n'est téléchargé ni envoyé à l'extérieur.

const fs = require('fs');
const path = require('path');

let worker = null;
let workerLangs = null;
let queue = Promise.resolve();

function dataPath() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'ocr-data');
  return packaged && fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'ocr-data');
}

// En application empaquetée, les modules à worker/WASM sont dépaquetés hors de l'archive asar.
const unasar = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

async function getWorker(langs) {
  if (worker && workerLangs === langs) return worker;
  if (worker) await terminate();
  const tess = require('tesseract.js');
  const opts = { langPath: dataPath(), gzip: true, cacheMethod: 'none' };
  try {
    opts.workerPath = unasar(require.resolve('tesseract.js/src/worker-script/node/index.js'));
    opts.corePath = unasar(path.dirname(require.resolve('tesseract.js-core/package.json')));
  } catch { /* chemins par défaut de tesseract.js */ }
  worker = await tess.createWorker(langs, 1, opts);
  workerLangs = langs;
  return worker;
}

/** Reconnaît le texte d'une image (Buffer PNG/JPEG/WebP). Appels sérialisés. */
function ocrImage(buf, langs = 'fra+eng') {
  const run = async () => {
    const w = await getWorker(langs);
    const { data } = await w.recognize(buf);
    return (data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const guarded = () => Promise.race([run(), new Promise((_, rej) => setTimeout(() => { terminate(); rej(new Error('OCR : délai dépassé')); }, 120000).unref())]);
  const p = queue.then(guarded, guarded);
  queue = p.catch(() => {});
  return p;
}

async function terminate() {
  if (worker) { const w = worker; worker = null; workerLangs = null; try { await w.terminate(); } catch { /* déjà arrêté */ } }
}

/** Rend une page de PDF en PNG (via pdf.js + @napi-rs/canvas). */
async function renderPage(pdf, n, scale = 2) {
  const unpdf = await import('unpdf');
  const img = await unpdf.renderPageAsImage(pdf, n, { canvasImport: () => import('@napi-rs/canvas'), scale });
  return Buffer.from(img);
}

module.exports = { ocrImage, renderPage, terminate, dataPath };
