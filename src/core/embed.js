'use strict';
// Embeddings locaux sans dépendance : hachage de mots, bigrammes et trigrammes de caractères
// (« hashing trick »), normalisés L2. Pas de réseau, pas de modèle à télécharger.
// Interface identique à celle d'un modèle neuronal : un changement de modèle = réindexation.

const DIM = 768;
const VERSION = 'hash-v1-' + DIM;

function norm(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set(
  'le la les un une des du de d l et ou en au aux a à est sont ce cet cette ces se sa son ses sur dans par pour que qui quoi dont il elle ils elles on nous vous je tu ne pas plus the of and to in is are was for on with as by at an be it this that from or'.split(' ')
);

function embedOne(text) {
  const v = new Float32Array(DIM);
  const words = norm(text).match(/[\p{L}\p{N}]+/gu) || [];
  const add = (feat, w) => {
    const h = fnv(feat);
    v[h % DIM] += (h & 0x80000000 ? -1 : 1) * w;
  };
  let prev = null;
  for (const w of words) {
    if (w.length < 2) continue;
    const stop = STOP.has(w);
    if (!stop) add('w:' + w, 1.0);
    if (!stop && w.length > 3) {
      const p = '^' + w + '$';
      for (let i = 0; i + 3 <= p.length; i++) add('c:' + p.slice(i, i + 3), 0.25);
    }
    if (prev && !stop) add('b:' + prev + '_' + w, 0.6);
    prev = stop ? null : w;
  }
  let n = 0;
  for (let i = 0; i < DIM; i++) {
    v[i] = Math.sign(v[i]) * Math.log1p(Math.abs(v[i]));
    n += v[i] * v[i];
  }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}

const toBlob = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
const fromBlob = (b) => {
  if (!b) return null;
  const copy = Buffer.from(b); // réaligne la mémoire
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
};

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

module.exports = { embedOne, toBlob, fromBlob, cosine, DIM, VERSION, norm };
