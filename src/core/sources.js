'use strict';
// Connecteurs de sources : Markdown/TXT (Obsidian), CSV, JSON, PDF (texte extractible).
// Chaque lecteur renvoie un texte de type Markdown que le parseur Obsidian sait traiter.

const fs = require('fs');
const path = require('path');

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  const delim = (text.split('\n', 1)[0].match(/;/g) || []).length > (text.split('\n', 1)[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

function csvToMarkdown(text, title) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (!rows.length) return '';
  const head = rows[0];
  return rows
    .slice(1)
    .map((r, i) => `## ${title} — ligne ${i + 1}\n` + head.map((h, k) => `- **${h}** : ${r[k] ?? ''}`).join('\n'))
    .join('\n\n');
}

function jsonToMarkdown(text, title) {
  const data = JSON.parse(text);
  const items = Array.isArray(data) ? data : [data];
  const flat = (o, pre = '') =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v) ? flat(v, pre + k + '.') : [`- **${pre}${k}** : ${Array.isArray(v) ? v.join(', ') : v}`]
    );
  return items.map((it, i) => `## ${title} — élément ${i + 1}\n` + (typeof it === 'object' && it ? flat(it).join('\n') : String(it))).join('\n\n');
}

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

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

/** @returns {Promise<{raw:string, kind:string}>} */
async function readSource(vault, rel, opts = {}) {
  const file = path.join(vault.path, rel);
  const ext = path.extname(rel).toLowerCase();
  const title = path.basename(rel, ext);
  if (ext === '.md' || ext === '.txt') return { raw: fs.readFileSync(file, 'utf8'), kind: ext.slice(1) };
  if (ext === '.csv') return { raw: csvToMarkdown(fs.readFileSync(file, 'utf8'), title), kind: 'csv' };
  if (ext === '.json') return { raw: jsonToMarkdown(fs.readFileSync(file, 'utf8'), title), kind: 'json' };
  if (ext === '.pdf') { const r = await pdfToText(fs.readFileSync(file), opts.ocr); return { raw: r.raw, kind: r.ocrPages ? 'pdf-ocr' : 'pdf' }; }
  if (IMAGE_EXT.includes(ext)) return { raw: await imageToText(file, title, opts.ocr), kind: 'image-ocr' };
  throw new Error('Format non pris en charge : ' + ext);
}

module.exports = { IMAGE_EXT, readSource, parseCSV, csvToMarkdown };
