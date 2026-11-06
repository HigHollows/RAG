'use strict';
// Parseur Obsidian : frontmatter, wikilinks, embeds, tags, alias, résolution de liens.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_EXCLUDES = ['.obsidian', '.trash', '_graph', '.git', 'node_modules'];

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function unquote(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function scalar(v) {
  v = v.trim();
  if (v === '') return '';
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((x) => unquote(x));
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return unquote(v);
}

/** Mini-parseur YAML suffisant pour le frontmatter Obsidian (scalaires, listes). */
function parseFrontmatter(raw) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!m) return { data: {}, bodyStart: 0 };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  let key = null;
  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const item = /^\s+-\s+(.*)$/.exec(line) || /^-\s+(.*)$/.exec(line);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = data[key] === '' || data[key] == null ? [] : [data[key]];
      data[key].push(unquote(item[1]));
      continue;
    }
    const kv = /^([^:#\s][^:]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1].trim();
      data[key] = scalar(kv[2]);
    }
  }
  return { data, bodyStart: m[0].length };
}

/** Masque (remplace par des espaces) les blocs de code pour ne pas y chercher liens et tags. */
function maskCode(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return text
    .replace(/```[\s\S]*?(```|$)/g, blank)
    .replace(/~~~[\s\S]*?(~~~|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank);
}

const WIKI_RE = /(!?)\[\[([^\]|#^]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g;
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu;

function toList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

function parseNote(raw, relPath) {
  const { data, bodyStart } = parseFrontmatter(raw);
  const body = raw.slice(bodyStart);
  const masked = maskCode(body);
  const base = path.basename(relPath).replace(/\.[^.]+$/, '');

  const links = [];
  let m;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(masked))) {
    const target = (m[2] || '').trim();
    const line = masked.slice(0, m.index).split('\n').length;
    links.push({
      embed: m[1] === '!',
      target, // vide => lien interne [[#Section]]
      section: m[3] != null ? m[3].trim() : null,
      alias: m[4] != null ? m[4].trim() : null,
      offset: bodyStart + m.index,
      length: m[0].length,
      line,
    });
  }

  const tags = new Set(toList(data.tags).concat(toList(data.tag)).map((t) => t.replace(/^#/, '')));
  TAG_RE.lastIndex = 0;
  // les liens [[...#x]] ne doivent pas produire de tag
  const noLinks = masked.replace(WIKI_RE, (s) => ' '.repeat(s.length));
  while ((m = TAG_RE.exec(noLinks))) {
    if (!/^\d+$/.test(m[2])) tags.add(m[2]);
  }

  return {
    path: relPath,
    title: data.title ? String(data.title) : base,
    basename: base,
    aliases: toList(data.aliases).concat(toList(data.alias)),
    tags: [...tags],
    frontmatter: data,
    body,
    bodyStart,
    links,
  };
}

/** Index de résolution : nom de fichier, puis alias, insensible à la casse. */
function buildResolver(notes) {
  const byName = new Map();
  const byAlias = new Map();
  const add = (map, key, n) => {
    key = key.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(n);
  };
  for (const n of notes) {
    add(byName, n.basename, n);
    add(byName, n.path.replace(/\.[^.]+$/, ''), n);
    for (const a of n.aliases) add(byAlias, a, n);
  }
  const pick = (cands, from) => {
    if (!cands || !cands.length) return null;
    if (cands.length === 1) return cands[0];
    const dir = path.dirname(from || '');
    return (
      cands.find((c) => path.dirname(c.path) === dir) ||
      [...cands].sort((a, b) => a.path.length - b.path.length)[0]
    );
  };
  return (target, fromPath) => {
    if (!target) return null;
    const t = target.replace(/\.md$/i, '').toLowerCase();
    return pick(byName.get(t), fromPath) || pick(byName.get(path.basename(t)), fromPath) || pick(byAlias.get(t), fromPath);
  };
}

function walk(root, excludes, exts, out = [], rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (excludes.includes(e.name)) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(root, excludes, exts, out, r);
    else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(r);
  }
  return out;
}

function listFiles(vault) {
  const excludes = DEFAULT_EXCLUDES.concat(vault.exclude || []);
  const exts = (vault.extensions || ['.md', '.txt', '.pdf', '.csv', '.json']).map((x) => x.toLowerCase());
  return walk(vault.path, excludes, exts);
}

function obsidianUri(vaultName, relPath) {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relPath.replace(/\.md$/i, ''))}`;
}

module.exports = { parseNote, parseFrontmatter, buildResolver, listFiles, sha256, obsidianUri, maskCode, DEFAULT_EXCLUDES };
