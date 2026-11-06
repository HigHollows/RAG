'use strict';
// Façade unique du noyau : toutes les interfaces (UI, CLI, MCP, HTTP) passent par ici.

const fs = require('fs');
const path = require('path');
const { Config } = require('./config');
const { Store } = require('./db');
const { LLM } = require('./llm');
const { Ingestor } = require('./ingest');
const { Retriever } = require('./retrieve');
const { Answerer } = require('./answer');
const { degrees } = require('./graph');
const { key } = require('./resolve');
const { norm, embedOne, toBlob } = require('./embed');
const { obsidianUri } = require('./obsidian');

class Core {
  constructor(dataDir, { transport, onEvent } = {}) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.config = new Config(dataDir);
    this.store = new Store(path.join(dataDir, 'graph.db'));
    this.llm = new LLM(this.store, this.config, transport);
    this.onEvent = onEvent || (() => {});
    this.retriever = new Retriever(this.store, this.config);
    this.answerer = new Answerer(this.retriever, this.llm, this.config);
    this.ingestor = null;
    this.progress = { running: false };
  }

  close() {
    this.store.close();
  }

  // ───── ingestion
  _ing() {
    return new Ingestor({
      store: this.store, config: this.config, llm: this.llm,
      onProgress: (p) => { this.progress = { running: p.step !== 'terminé', ...p }; this.onEvent('progress', this.progress); },
    });
  }

  async estimate(opts) { return this._ing().estimate(opts); }

  async ingest(opts = {}) {
    if (this.ingestor && this.ingestor._running) throw new Error('Une ingestion est déjà en cours');
    this.ingestor = this._ing();
    this.progress = { running: true, step: 'démarrage', done: 0, total: 0 };
    try {
      const r = await this.ingestor.run(opts);
      if (this.config.data.vaults.some((v) => v.writeGraphNotes !== false)) {
        try { require('./exporter').writeGraphNotes(this); } catch (e) { r.errors.push('notes _graph : ' + e.message); }
      }
      return r;
    } finally {
      this.progress = { ...this.progress, running: false };
      this.onEvent('progress', this.progress);
    }
  }

  cancelIngest() { if (this.ingestor) this.ingestor.cancel(); }

  async rebuild() {
    this.store.tx(() => {
      for (const t of ['review', 'communities', 'relations', 'mentions', 'links', 'doc_tags', 'chunks', 'documents']) this.store.exec(`DELETE FROM ${t}`);
      this.store.exec('DELETE FROM chunks_fts; DELETE FROM entities_fts; DELETE FROM entities; DELETE FROM meta WHERE key=\'last_ingest\'');
    });
    return this.ingest({ full: true });
  }

  // ───── statut
  status() {
    const s = this.store;
    const c = (t, w = '') => s.get(`SELECT COUNT(*) c FROM ${t} ${w}`).c;
    const last = s.get("SELECT * FROM jobs ORDER BY id DESC LIMIT 1");
    const month = this.llm.monthSpent();
    return {
      vaults: this.config.data.vaults.map((v) => ({ ...v, documents: s.get('SELECT COUNT(*) c FROM documents WHERE vault=?', v.name).c, exists: fs.existsSync(v.path) })),
      documents: c('documents'), chunks: c('chunks'), entities: c('entities'), relations: c('relations'), communities: c('communities', 'WHERE level=0'),
      pendingExtraction: c('chunks', 'WHERE extracted IN (0,2)'),
      review: c('review', "WHERE status='open'"),
      lastIngest: s.getMeta('last_ingest'),
      lastJob: last ? { ...last, stats: JSON.parse(last.stats || '{}'), errors: JSON.parse(last.errors || '[]') } : null,
      costMonth: month, costTotal: s.get('SELECT COALESCE(SUM(cost),0) c FROM cost_log').c,
      llm: { available: this.llm.available(), hasKey: !!this.config.apiKey() },
      progress: this.progress, dataDir: this.dataDir,
    };
  }

  costs() {
    return {
      byDay: this.store.all("SELECT date(ts) day, ROUND(SUM(cost),4) cost, SUM(tokens_in) tin, SUM(tokens_out) tout FROM cost_log GROUP BY day ORDER BY day DESC LIMIT 60"),
      byModel: this.store.all('SELECT model, ROUND(SUM(cost),4) cost, COUNT(*) calls FROM cost_log GROUP BY model'),
      byStep: this.store.all('SELECT step, ROUND(SUM(cost),4) cost, COUNT(*) calls FROM cost_log GROUP BY step'),
      month: this.llm.monthSpent(), budgetMonth: this.config.data.llm.budgetPerMonth,
    };
  }

  jobs() { return this.store.all('SELECT * FROM jobs ORDER BY id DESC LIMIT 30').map((j) => ({ ...j, stats: JSON.parse(j.stats || '{}'), errors: JSON.parse(j.errors || '[]') })); }

  // ───── questions
  ask(question, opts) { return this.answerer.ask(question, opts); }

  searchEntities(q, limit = 20) {
    if (!q || !q.trim()) return this.store.all('SELECT id, name, type FROM entities ORDER BY name LIMIT ?', limit);
    return this.retriever.findEntities(q, limit).map(({ id, name, type, score }) => ({ id, name, type, score }));
  }

  entity(ref) {
    const s = this.store;
    const e = typeof ref === 'number' ? s.get('SELECT * FROM entities WHERE id=?', ref) : this.retriever.resolveEntity(String(ref));
    if (!e) return null;
    const full = s.get('SELECT * FROM entities WHERE id=?', e.id);
    const rels = s.all(`SELECT r.id, r.subj, r.pred, r.obj, r.quote, r.confidence, r.origin, r.locked, r.chunk_id, a.name sname, b.name oname FROM relations r JOIN entities a ON a.id=r.subj JOIN entities b ON b.id=r.obj WHERE r.subj=? OR r.obj=? ORDER BY r.confidence DESC, r.id LIMIT 200`, full.id, full.id);
    const notes = s.all(`SELECT d.id, d.title, d.path, SUM(m.count) n FROM mentions m JOIN chunks c ON c.id=m.chunk_id JOIN documents d ON d.id=c.doc_id WHERE m.entity_id=? GROUP BY d.id ORDER BY n DESC LIMIT 50`, full.id)
      .map((d) => ({ ...d, uri: obsidianUri(this.vaultOf(d.id), d.path) }));
    const comm = full.community_id ? s.get('SELECT id, title, summary FROM communities WHERE id=?', full.community_id) : null;
    const hist = s.all('SELECT * FROM corrections WHERE target=? OR payload LIKE ? ORDER BY id DESC LIMIT 20', full.name, `%${full.name.replace(/[%_]/g, '')}%`);
    return { id: full.id, name: full.name, type: full.type, aliases: JSON.parse(full.aliases), description: full.description, locked: !!full.locked, docId: full.doc_id, community: comm, relations: rels.map((r) => ({ id: r.id, subject: r.sname, subjectId: r.subj, predicate: r.pred, object: r.oname, objectId: r.obj, quote: r.quote, confidence: r.confidence, origin: r.origin, chunkId: r.chunk_id })), notes, corrections: hist };
  }

  vaultOf(docId) { return this.store.get('SELECT vault FROM documents WHERE id=?', docId)?.vault; }

  note(ref) { return this.retriever.note(ref); }
  noteList(q) {
    const rows = this.store.all('SELECT d.id, d.title, d.path, d.vault, d.tags, (SELECT COUNT(*) FROM links l WHERE l.target_doc_id=d.id) AS inbound, (SELECT COUNT(*) FROM links l WHERE l.doc_id=d.id) AS outbound FROM documents d ORDER BY d.title');
    const k = q ? norm(q) : null;
    return rows.filter((r) => !k || norm(r.title + ' ' + r.path + ' ' + r.tags).includes(k)).slice(0, 500).map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
  }
  chunk(id) { return this.retriever.chunkInfo(id); }
  path(a, b) { return this.retriever.path(a, b); }
  communityList() {
    return this.store.all("SELECT id, title, summary, size FROM communities WHERE level=0 ORDER BY size DESC").map((c) => ({ ...c, members: this.store.all('SELECT id, name, type FROM entities WHERE community_id=? ORDER BY name LIMIT 30', c.id), subs: this.store.all('SELECT id, title, size FROM communities WHERE parent_id=? ORDER BY size DESC', c.id) }));
  }

  // ───── données pour la vue graphe
  graph({ type, community, tag, q, limit = 600 } = {}) {
    const s = this.store;
    const deg = degrees(s);
    let ents = s.all('SELECT id, name, type, community_id c, doc_id FROM entities');
    if (type) ents = ents.filter((e) => e.type === type);
    if (community) ents = ents.filter((e) => e.c === Number(community));
    if (tag) {
      const docs = new Set(s.all('SELECT doc_id FROM doc_tags WHERE tag=? OR tag LIKE ?', tag, tag + '/%').map((r) => r.doc_id));
      ents = ents.filter((e) => e.doc_id && docs.has(e.doc_id));
    }
    if (q) { const k = key(q); ents = ents.filter((e) => key(e.name).includes(k)); }
    ents = ents.map((e) => ({ ...e, degree: deg.get(e.id) || 0 })).sort((a, b) => b.degree - a.degree || a.id - b.id);
    const total = ents.length;
    ents = ents.slice(0, limit);
    const ids = new Set(ents.map((e) => e.id));
    const seen = new Map();
    for (const r of s.all('SELECT subj, obj, pred, confidence FROM relations')) {
      if (!ids.has(r.subj) || !ids.has(r.obj)) continue;
      const k = r.subj < r.obj ? r.subj + ':' + r.obj : r.obj + ':' + r.subj;
      const x = seen.get(k) || { source: r.subj, target: r.obj, preds: new Set(), w: 0 };
      x.preds.add(r.pred); x.w += r.confidence; seen.set(k, x);
    }
    return {
      total, nodes: ents.map((e) => ({ id: e.id, name: e.name, type: e.type, community: e.c, degree: e.degree, isNote: !!e.doc_id })),
      edges: [...seen.values()].map((x) => ({ source: x.source, target: x.target, label: [...x.preds].join(', '), w: x.w })),
      types: s.all('SELECT DISTINCT type FROM entities ORDER BY type').map((r) => r.type),
      tags: s.all('SELECT tag, COUNT(*) n FROM doc_tags GROUP BY tag ORDER BY n DESC LIMIT 100'),
      communities: s.all('SELECT id, title FROM communities WHERE level=0 ORDER BY size DESC'),
    };
  }

  // ───── revue et corrections
  reviews(status = 'open') {
    return this.store.all('SELECT * FROM review WHERE status=? ORDER BY kind, id LIMIT 500', status).map((r) => {
      const p = JSON.parse(r.payload || '{}');
      if (r.kind === 'merge_candidate') {
        const a = this.store.get('SELECT id, name, type FROM entities WHERE id=?', p.a);
        const b = this.retriever.resolveEntity(p.b);
        return { ...r, payload: { ...p, aId: a?.id, aName: a?.name, bId: b?.id, bName: b?.name || p.b } };
      }
      return { ...r, payload: p };
    });
  }

  correct(action, args) {
    const s = this.store;
    const log = (target, payload) => s.run('INSERT INTO corrections(action,target,payload) VALUES(?,?,?)', action, target, JSON.stringify(payload || {}));
    if (action === 'rename') {
      const e = s.get('SELECT * FROM entities WHERE id=?', args.id);
      const nn = String(args.name).trim();
      if (!e || !nn) throw new Error('Entité ou nom invalide');
      s.tx(() => {
        s.run('UPDATE entities SET name=?, norm=?, locked=1 WHERE id=?', nn, key(nn), e.id);
        s.run('UPDATE entities_fts SET name=? WHERE rowid=?', nn, e.id);
        s.run('UPDATE entities SET embedding=? WHERE id=?', toBlob(embedOne(`${nn}. ${e.description}`)), e.id);
        log(e.name, { to: nn });
      });
    } else if (action === 'merge') {
      const a = s.get('SELECT * FROM entities WHERE id=?', args.into);
      const b = s.get('SELECT * FROM entities WHERE id=?', args.from);
      if (!a || !b || a.id === b.id) throw new Error('Fusion invalide');
      if (a.doc_id && b.doc_id) throw new Error('Impossible de fusionner deux notes distinctes');
      s.tx(() => {
        const al = new Set([...JSON.parse(a.aliases), b.name, ...JSON.parse(b.aliases)]);
        al.delete(a.name);
        s.run('UPDATE OR IGNORE mentions SET entity_id=? WHERE entity_id=?', a.id, b.id);
        s.run('UPDATE relations SET subj=? WHERE subj=?', a.id, b.id);
        s.run('UPDATE relations SET obj=? WHERE obj=?', a.id, b.id);
        s.run('DELETE FROM relations WHERE subj=obj');
        s.run('UPDATE entities SET aliases=?, locked=1, doc_id=COALESCE(doc_id,?) WHERE id=?', JSON.stringify([...al]), b.doc_id, a.id);
        s.run('UPDATE entities_fts SET aliases=? WHERE rowid=?', [...al].join(' '), a.id);
        s.run('DELETE FROM entities_fts WHERE rowid=?', b.id);
        s.run('DELETE FROM entities WHERE id=?', b.id);
        log(b.name, { into: a.name });
      });
    } else if (action === 'delete') {
      const e = s.get('SELECT * FROM entities WHERE id=?', args.id);
      if (!e) throw new Error('Entité introuvable');
      s.tx(() => { s.run('DELETE FROM entities_fts WHERE rowid=?', e.id); s.run('DELETE FROM entities WHERE id=?', e.id); log(e.name, {}); });
    } else if (action === 'add_relation') {
      const a = s.get('SELECT * FROM entities WHERE id=?', args.subj), b = s.get('SELECT * FROM entities WHERE id=?', args.obj);
      if (!a || !b) throw new Error('Entités invalides');
      s.tx(() => { s.run("INSERT INTO relations(subj,pred,obj,quote,confidence,locked,origin) VALUES(?,?,?,?,1,1,'manual')", a.id, args.pred || 'lié_à', b.id, args.quote || ''); log(a.name, { pred: args.pred, obj: b.name }); });
    } else if (action === 'delete_relation') {
      s.run('DELETE FROM relations WHERE id=?', args.id);
    } else throw new Error('Action inconnue : ' + action);
    this.retriever._cache = null;
    return { ok: true };
  }

  resolveReview(id, decision) {
    const r = this.store.get('SELECT * FROM review WHERE id=?', id);
    if (!r) throw new Error('Élément introuvable');
    const p = JSON.parse(r.payload);
    if (r.kind === 'merge_candidate' && decision === 'accept') {
      const b = this.retriever.resolveEntity(p.b);
      if (b && b.id !== p.a) this.correct('merge', { into: p.a, from: b.id });
    }
    if (r.kind === 'extraction_failed' && decision === 'retry') this.store.run('UPDATE chunks SET extracted=0 WHERE id=?', p.chunk);
    this.store.run("UPDATE review SET status=? WHERE id=?", decision === 'accept' ? 'accepted' : decision === 'retry' ? 'retried' : 'rejected', id);
    return { ok: true };
  }

  exportCorrections() { return this.store.all('SELECT action, target, payload, author, date FROM corrections ORDER BY id'); }
  importCorrections(list) {
    this.store.tx(() => { for (const c of list) this.store.run('INSERT INTO corrections(action,target,payload,author,date) VALUES(?,?,?,?,?)', c.action, c.target, typeof c.payload === 'string' ? c.payload : JSON.stringify(c.payload || {}), c.author || 'import', c.date || new Date().toISOString()); });
    return { imported: list.length };
  }

  // ───── réglages
  getSettings() { return this.config.publicView(); }
  setSettings(patch) {
    if (patch.llm && patch.llm.apiKey === '') delete patch.llm.apiKey; // champ vide = ne pas toucher
    const clear = patch.llm && patch.llm.clearKey;
    if (patch.llm) delete patch.llm.clearKey;
    this.config.update(patch);
    if (clear) { this.config.data.llm.apiKey = ''; this.config.save(); }
    return this.getSettings();
  }
}

module.exports = { Core };
