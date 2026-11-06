'use strict';
// Recherche : locale (entités + voisinage + chunks), globale (communautés), chemin, note. Routage par règles.

const { embedOne, fromBlob, cosine, norm } = require('./embed');
const { neighborhood, shortestPath, degrees } = require('./graph');
const { key } = require('./resolve');
const { obsidianUri } = require('./obsidian');
const { approxTokens } = require('./chunker');

const WORD = /[\p{L}\p{N}]+/gu;
const STOPW = new Set('le la les un une des du de d l et ou en au aux est sont ce se sa son ses sur dans par pour que qui quoi dont il elle on nous vous je tu ne pas plus quel quelle quels quelles quoi comment pourquoi avec sans entre mes mon ma ai as a avoir etre fait the of and to in is are what who how why with'.split(' '));

function ftsQuery(text) {
  const words = [...new Set((norm(text).match(WORD) || []).filter((w) => w.length > 2 && !STOPW.has(w)))].slice(0, 12);
  return words.length ? words.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ') : null;
}

class Retriever {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this._cache = null;
  }

  get cfg() {
    return this.config.data.retrieval;
  }

  _vectors() {
    const stamp = this.store.getMeta('last_ingest', '') + ':' + this.store.get('SELECT COUNT(*) c FROM chunks').c + ':' + this.store.get('SELECT COUNT(*) c FROM entities').c;
    if (this._cache && this._cache.stamp === stamp) return this._cache;
    const chunks = this.store.all('SELECT id, embedding FROM chunks').map((r) => ({ id: r.id, v: fromBlob(r.embedding) }));
    const ents = this.store.all('SELECT id, embedding FROM entities').map((r) => ({ id: r.id, v: fromBlob(r.embedding) }));
    this._cache = { stamp, chunks, ents };
    return this._cache;
  }

  /** Entités citées ou proches de la question. */
  findEntities(question, limit = 6) {
    const s = this.store;
    const nq = ' ' + key(question) + ' ';
    const scores = new Map();
    const bump = (id, v) => scores.set(id, (scores.get(id) || 0) + v);
    for (const e of s.all('SELECT id, name, norm, aliases FROM entities')) {
      for (const n of [e.norm, ...JSON.parse(e.aliases || '[]').map(key)]) {
        if (n.length >= 3 && nq.includes(' ' + n + ' ')) { bump(e.id, 2 + Math.min(n.length, 30) / 30); break; }
      }
    }
    const q = ftsQuery(question);
    if (q) {
      s.all('SELECT rowid id, bm25(entities_fts) r FROM entities_fts WHERE entities_fts MATCH ? ORDER BY r LIMIT 10', q).forEach((r, i) => bump(r.id, 0.8 / (1 + i)));
    }
    const qv = embedOne(question);
    const { ents } = this._vectors();
    const top = ents.map((e) => ({ id: e.id, c: cosine(qv, e.v) })).sort((a, b) => b.c - a.c).slice(0, 8);
    for (const t of top) if (t.c > 0.25) bump(t.id, t.c);
    return [...scores].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, score]) => ({ ...s.get('SELECT id, name, type, description, community_id FROM entities WHERE id=?', id), score }));
  }

  /** Recherche hybride (FTS5 + vecteurs), fusion par rang réciproque. */
  searchChunks(question, limit = 20) {
    const s = this.store;
    const ranks = new Map();
    const add = (id, r, w = 1) => ranks.set(id, (ranks.get(id) || 0) + w / (60 + r));
    const q = ftsQuery(question);
    const fts = new Set();
    if (q) s.all('SELECT rowid id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 1.0, 0.5) LIMIT 40', q).forEach((r, i) => { add(r.id, i); fts.add(r.id); });
    const qv = embedOne(question);
    const cos = new Map();
    const top = this._vectors().chunks.map((c) => ({ id: c.id, c: cosine(qv, c.v) })).sort((a, b) => b.c - a.c).slice(0, 40);
    top.forEach((t, i) => { cos.set(t.id, t.c); if (t.c > 0.1) add(t.id, i); });
    return [...ranks].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, score]) => ({ id, score, fts: fts.has(id), cos: cos.get(id) || 0 }));
  }

  chunkInfo(id) {
    const c = this.store.get(
      `SELECT c.id, c.text, c.heading_path AS headingPath, c.offset, c.tokens, d.id AS docId, d.title, d.path, d.vault FROM chunks c JOIN documents d ON d.id=c.doc_id WHERE c.id=?`, id);
    if (!c) return null;
    return { ...c, uri: obsidianUri(c.vault, c.path) };
  }

  /** @returns {{mode:string, entities:any[], relations:any[], chunks:any[], communities?:any[]}} */
  local(question) {
    const s = this.store;
    const ents = this.findEntities(question);
    const strong = ents.filter((e) => e.score >= 1.5);
    const seeds = (strong.length ? strong : ents.slice(0, 2)).map((e) => e.id);
    const hood = seeds.length ? neighborhood(s, seeds, this.cfg.depth, this.cfg.maxNeighbors) : { nodes: [], edges: [] };
    const names = new Map(s.all(`SELECT id, name, type FROM entities WHERE id IN (${[0, ...hood.nodes.map((n) => n.id)].join(',')})`).map((e) => [e.id, e]));

    const hits = this.searchChunks(question, 24);
    const score = new Map(hits.map((h) => [h.id, h]));
    // chunks liés aux entités du voisinage (mentions + provenance des relations)
    const boost = new Map();
    for (const id of seeds) {
      for (const m of s.all('SELECT chunk_id FROM mentions WHERE entity_id=? LIMIT 30', id)) boost.set(m.chunk_id, (boost.get(m.chunk_id) || 0) + 0.02);
    }
    for (const e of hood.edges) if (e.chunk_id) boost.set(e.chunk_id, (boost.get(e.chunk_id) || 0) + 0.015);
    const all = new Set([...score.keys(), ...boost.keys()]);
    const ranked = [...all].map((id) => {
      const h = score.get(id);
      const relevant = !!h && (h.fts || h.cos >= 0.18);
      return { id, rel: relevant, score: (h ? h.score : 0) + (boost.get(id) || 0) * (h || seeds.length ? 1 : 0.5) };
    }).sort((a, b) => b.score - a.score);

    const chunks = [];
    let budget = this.cfg.contextTokens;
    const perDoc = new Map();
    for (const r of ranked) {
      if (chunks.length >= this.cfg.topChunks) break;
      const info = this.chunkInfo(r.id);
      if (!info || budget - info.tokens < 0) continue;
      if ((perDoc.get(info.docId) || 0) >= 3) continue;
      perDoc.set(info.docId, (perDoc.get(info.docId) || 0) + 1);
      budget -= info.tokens;
      chunks.push({ ...info, score: r.score, relevant: r.rel });
    }
    const relations = hood.edges.slice(0, 40).map((e) => ({ id: e.id, subject: names.get(e.subj)?.name, predicate: e.pred, object: names.get(e.obj)?.name, quote: e.quote, chunkId: e.chunk_id, confidence: e.confidence }));
    return { mode: 'local', entities: ents, relations, chunks, hasEvidence: chunks.some((c) => c.relevant) };
  }

  global(question) {
    const s = this.store;
    const qv = embedOne(question);
    const comms = s.all("SELECT id, title, summary, members, embedding, size FROM communities WHERE level=0").map((c) => ({ ...c, c: cosine(qv, fromBlob(c.embedding)) }));
    const q = ftsQuery(question);
    const words = q ? (norm(question).match(WORD) || []).filter((w) => w.length > 3 && !STOPW.has(w)) : [];
    for (const c of comms) {
      const t = norm(c.title + ' ' + c.summary);
      c.c += words.filter((w) => t.includes(w)).length * 0.08;
    }
    const top = comms.sort((a, b) => b.c - a.c).slice(0, this.cfg.globalCommunities).filter((c) => c.c > 0.05);
    const out = top.map((c) => ({
      id: c.id, title: c.title, summary: c.summary, size: c.size, score: c.c,
      members: s.all(`SELECT id, name, type FROM entities WHERE community_id=? ORDER BY id LIMIT 12`, c.id),
    }));
    // quelques chunks de support
    const chunks = this.searchChunks(question, 8).filter((h) => h.fts || h.cos >= 0.18).map((h) => this.chunkInfo(h.id)).filter(Boolean).slice(0, 4);
    return { mode: 'global', entities: [], relations: [], chunks, communities: out, hasEvidence: out.length > 0 || chunks.length > 0 };
  }

  resolveEntity(name) {
    const k = key(name);
    const s = this.store;
    let e = s.get('SELECT id, name, type, description FROM entities WHERE norm=?', k);
    if (e) return e;
    for (const r of s.all('SELECT id, name, type, description, aliases FROM entities')) {
      if (JSON.parse(r.aliases || '[]').some((a) => key(a) === k)) return r;
    }
    const top = this.findEntities(name, 1)[0];
    return top && top.score >= 1 ? top : null;
  }

  path(a, b) {
    const ea = this.resolveEntity(a), eb = this.resolveEntity(b);
    if (!ea || !eb) return { mode: 'path', found: false, missing: [!ea && a, !eb && b].filter(Boolean), nodes: [], edges: [], chunks: [], entities: [], relations: [], hasEvidence: false };
    const p = shortestPath(this.store, ea.id, eb.id);
    if (!p) return { mode: 'path', found: false, from: ea, to: eb, nodes: [], edges: [], chunks: [], entities: [ea, eb], relations: [], hasEvidence: false };
    const nodes = p.nodes.map((id) => this.store.get('SELECT id, name, type FROM entities WHERE id=?', id));
    const nm = new Map(nodes.map((n) => [n.id, n.name]));
    const edges = p.edges.map((e) => ({ id: e.id, subject: nm.get(e.subj), predicate: e.pred, object: nm.get(e.obj), quote: e.quote, chunkId: e.chunk_id, confidence: e.confidence }));
    const chunks = [...new Set(p.edges.map((e) => e.chunk_id).filter(Boolean))].map((id) => this.chunkInfo(id)).filter(Boolean);
    return { mode: 'path', found: true, from: ea, to: eb, nodes, edges, entities: nodes, relations: edges, chunks, hasEvidence: true };
  }

  note(ref) {
    const s = this.store;
    const k = key(ref);
    let d = s.get('SELECT * FROM documents WHERE path=? OR path=?', ref, ref + '.md') || s.all('SELECT * FROM documents').find((x) => key(x.title) === k || JSON.parse(x.aliases || '[]').some((a) => key(a) === k) || key(x.path.replace(/\.[^.]+$/, '')) === k);
    if (!d) return null;
    const chunks = s.all('SELECT id, ord, heading_path AS headingPath, text FROM chunks WHERE doc_id=? ORDER BY ord', d.id);
    const entities = s.all(`SELECT DISTINCT e.id, e.name, e.type FROM mentions m JOIN entities e ON e.id=m.entity_id JOIN chunks c ON c.id=m.chunk_id WHERE c.doc_id=? ORDER BY e.name`, d.id);
    const out = s.all('SELECT l.target_raw, l.type, l.section, t.title AS target_title, t.path AS target_path FROM links l LEFT JOIN documents t ON t.id=l.target_doc_id WHERE l.doc_id=?', d.id);
    const inn = s.all('SELECT DISTINCT s.title, s.path FROM links l JOIN documents s ON s.id=l.doc_id WHERE l.target_doc_id=?', d.id);
    return { id: d.id, title: d.title, path: d.path, vault: d.vault, tags: JSON.parse(d.tags), aliases: JSON.parse(d.aliases), frontmatter: JSON.parse(d.frontmatter), uri: obsidianUri(d.vault, d.path), chunks, entities, links: out, backlinks: inn, summary: chunks.map((c) => c.text).join('\n\n') };
  }

  /** Choisit le mode par règles ; l'utilisateur peut le forcer. */
  route(question) {
    const q = norm(question);
    const m = /(?:lien|relation|chemin|rapport)s?\s+(?:entre|de)\s+(.+?)\s+(?:et|avec|to|and)\s+(.+?)[\s?.!]*$/.exec(q) || /comment\s+(.+?)\s+(?:est|sont)[- ]*(?:il|elle|ils)?\s*(?:lie|liee|relie|reliee|connecte)\s*(?:a|au|aux|avec)\s+(.+?)[\s?.!]*$/.exec(q);
    if (m) return { mode: 'path', a: m[1], b: m[2] };
    if (/(themes?|tendances?|idees? (?:qui )?revien|grandes? lignes|vue d'ensemble|de quoi parlent|principaux sujets|synthese|resume.*(notes|coffre|vault)|qu'est-ce qui revient|panorama)/.test(q)) return { mode: 'global' };
    return { mode: 'local' };
  }
}

module.exports = { Retriever, ftsQuery };
