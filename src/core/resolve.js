'use strict';
// Résolution d'entités : normalisation, alias, similarité, corrections manuelles persistantes.

const { embedOne, toBlob, norm } = require('./embed');

function key(name) {
  return norm(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function levRatio(a, b) {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

class Resolver {
  constructor(store, cfg) {
    this.store = store;
    this.cfg = cfg;
    this.reload();
  }

  reload() {
    this.byKey = new Map();
    this.list = [];
    for (const e of this.store.all('SELECT id, name, norm, type, aliases FROM entities')) {
      this._index(e.id, e.name, e.type, JSON.parse(e.aliases || '[]'));
    }
    this.rules = { merge: new Map(), del: new Set(), rename: new Map() };
    for (const c of this.store.all('SELECT action, target, payload FROM corrections ORDER BY id')) {
      const p = JSON.parse(c.payload || '{}');
      if (c.action === 'merge') this.rules.merge.set(key(c.target), p.into);
      else if (c.action === 'delete') this.rules.del.add(key(c.target));
      else if (c.action === 'rename') this.rules.rename.set(key(c.target), p.to);
    }
    this.pairsSeen = new Set(this.store.all("SELECT payload FROM review WHERE kind='merge_candidate'").map((r) => r.payload));
  }

  _index(id, name, type, aliases) {
    this.byKey.set(key(name), id);
    for (const a of aliases) if (!this.byKey.has(key(a))) this.byKey.set(key(a), id);
    this.list.push({ id, k: key(name), type });
  }

  /** Renvoie l'id de l'entité (créée ou fusionnée), ou null si supprimée par une correction. */
  upsert({ name, type = 'Autre', description = '', docId = null, aliases = [] }) {
    let k = key(name);
    if (!k) return null;
    if (this.rules.rename.has(k)) { name = this.rules.rename.get(k); k = key(name); }
    if (this.rules.merge.has(k)) { name = this.rules.merge.get(k); k = key(name); }
    if (this.rules.del.has(k)) return null;

    let id = this.byKey.get(k);
    if (!id && k.length >= 5) {
      // similarité floue (même type), prudente
      let best = null;
      for (const c of this.list) {
        if (Math.abs(c.k.length - k.length) > 3 || c.k[0] !== k[0]) continue;
        if (c.type !== type && c.type !== 'Note' && type !== 'Note' && c.type !== 'Autre' && type !== 'Autre') continue;
        const s = levRatio(c.k, k);
        if (!best || s > best.s) best = { c, s };
      }
      if (best && best.s >= this.cfg.mergeThreshold) id = best.c.id;
      else if (best && best.s >= this.cfg.reviewThreshold) {
        const payload = JSON.stringify({ a: best.c.id, b: name, score: Math.round(best.s * 100) / 100 });
        if (!this.pairsSeen.has(payload)) {
          this.pairsSeen.add(payload);
          this.store.run("INSERT INTO review(kind,payload) VALUES('merge_candidate',?)", payload);
        }
      }
    }
    const s = this.store;
    if (id) {
      const e = s.get('SELECT * FROM entities WHERE id=?', id);
      if (e.locked) return id;
      const al = JSON.parse(e.aliases || '[]');
      const upd = {};
      if (key(name) !== e.norm && !al.some((a) => key(a) === key(name)) && key(name) !== key(e.name)) {
        al.push(name);
        upd.aliases = JSON.stringify(al);
        this.byKey.set(key(name), id);
      }
      if ((e.type === 'Note' || e.type === 'Autre') && type !== 'Autre' && type !== 'Note' && e.type !== type) upd.type = type;
      if (!e.description && description) upd.description = description;
      if (docId && !e.doc_id) upd.doc_id = docId;
      for (const a of aliases) if (!al.some((x) => key(x) === key(a))) { al.push(a); this.byKey.set(key(a), id); upd.aliases = JSON.stringify(al); }
      if (Object.keys(upd).length) {
        const cols = Object.keys(upd);
        s.run(`UPDATE entities SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`, ...cols.map((c) => upd[c]), id);
        if (upd.aliases) s.run('UPDATE entities_fts SET aliases=? WHERE rowid=?', al.join(' '), id);
        if (upd.description) s.run('UPDATE entities SET embedding=? WHERE id=?', toBlob(embedOne(`${e.name}. ${upd.description}`)), id);
      }
      return id;
    }
    const r = s.run(
      'INSERT INTO entities(name,norm,type,aliases,description,embedding,doc_id) VALUES(?,?,?,?,?,?,?)',
      name,
      k,
      type,
      JSON.stringify(aliases),
      description,
      toBlob(embedOne(`${name}. ${description}`)),
      docId
    );
    const nid = Number(r.lastInsertRowid);
    s.run('INSERT INTO entities_fts(rowid,name,aliases) VALUES(?,?,?)', nid, name, aliases.join(' '));
    this._index(nid, name, type, aliases);
    return nid;
  }
}

module.exports = { Resolver, key, levRatio };
