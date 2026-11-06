'use strict';
// Stockage SQLite (node:sqlite) avec migrations numérotées. Une seule couche d'accès.

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = [
  // 1 : schéma initial
  `
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE documents(
    id INTEGER PRIMARY KEY, vault TEXT NOT NULL, path TEXT NOT NULL, title TEXT, aliases TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]', frontmatter TEXT DEFAULT '{}', hash TEXT, mtime REAL, kind TEXT DEFAULT 'md',
    status TEXT DEFAULT 'ok', ingested_at TEXT, UNIQUE(vault, path));
  CREATE TABLE chunks(
    id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ord INTEGER, heading_path TEXT, text TEXT, offset INTEGER, tokens INTEGER, hash TEXT,
    extracted INTEGER DEFAULT 0, embedding BLOB);
  CREATE INDEX idx_chunks_doc ON chunks(doc_id);
  CREATE VIRTUAL TABLE chunks_fts USING fts5(text, heading, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE entities(
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, norm TEXT NOT NULL, type TEXT DEFAULT 'Autre',
    aliases TEXT DEFAULT '[]', description TEXT DEFAULT '', embedding BLOB, community_id INTEGER,
    locked INTEGER DEFAULT 0, doc_id INTEGER, UNIQUE(norm, type));
  CREATE INDEX idx_entities_norm ON entities(norm);
  CREATE VIRTUAL TABLE entities_fts USING fts5(name, aliases, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE relations(
    id INTEGER PRIMARY KEY, subj INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    pred TEXT NOT NULL, obj INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    quote TEXT, chunk_id INTEGER REFERENCES chunks(id) ON DELETE CASCADE, confidence REAL DEFAULT 1,
    locked INTEGER DEFAULT 0, origin TEXT DEFAULT 'llm');
  CREATE INDEX idx_rel_subj ON relations(subj);
  CREATE INDEX idx_rel_obj ON relations(obj);
  CREATE INDEX idx_rel_chunk ON relations(chunk_id);
  CREATE TABLE mentions(
    entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
    chunk_id INTEGER REFERENCES chunks(id) ON DELETE CASCADE, count INTEGER DEFAULT 1,
    PRIMARY KEY(entity_id, chunk_id));
  CREATE INDEX idx_mentions_chunk ON mentions(chunk_id);
  CREATE TABLE links(
    id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    target_doc_id INTEGER, target_raw TEXT, type TEXT, section TEXT, chunk_id INTEGER, quote TEXT);
  CREATE INDEX idx_links_doc ON links(doc_id);
  CREATE INDEX idx_links_target ON links(target_doc_id);
  CREATE TABLE doc_tags(doc_id INTEGER REFERENCES documents(id) ON DELETE CASCADE, tag TEXT, PRIMARY KEY(doc_id, tag));
  CREATE TABLE communities(
    id INTEGER PRIMARY KEY, level INTEGER DEFAULT 0, parent_id INTEGER, title TEXT, members TEXT DEFAULT '[]',
    summary TEXT, embedding BLOB, fingerprint TEXT, size INTEGER DEFAULT 0);
  CREATE TABLE corrections(
    id INTEGER PRIMARY KEY, action TEXT NOT NULL, target TEXT, payload TEXT DEFAULT '{}',
    author TEXT DEFAULT 'utilisateur', date TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE review(
    id INTEGER PRIMARY KEY, kind TEXT, payload TEXT, status TEXT DEFAULT 'open', created TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE cost_log(
    id INTEGER PRIMARY KEY, ts TEXT DEFAULT CURRENT_TIMESTAMP, model TEXT, tokens_in INTEGER, tokens_out INTEGER,
    cost REAL, step TEXT);
  CREATE TABLE jobs(
    id INTEGER PRIMARY KEY, type TEXT, status TEXT, step TEXT, errors TEXT DEFAULT '[]', stats TEXT DEFAULT '{}',
    started TEXT, ended TEXT);
  CREATE TABLE llm_cache(key TEXT PRIMARY KEY, response TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP);
  `,
];

class Store {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;');
    this._migrate();
    this._stmts = new Map();
  }

  _migrate() {
    const v = this.db.prepare('PRAGMA user_version').get().user_version;
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[i]);
        this.db.exec(`PRAGMA user_version=${i + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  _stmt(sql) {
    let s = this._stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this._stmts.set(sql, s);
    }
    return s;
  }

  run(sql, ...p) {
    return this._stmt(sql).run(...p);
  }
  get(sql, ...p) {
    return this._stmt(sql).get(...p);
  }
  all(sql, ...p) {
    return this._stmt(sql).all(...p);
  }
  exec(sql) {
    this.db.exec(sql);
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  getMeta(k, d = null) {
    const r = this.get('SELECT value FROM meta WHERE key=?', k);
    return r ? r.value : d;
  }
  setMeta(k, v) {
    this.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  }

  /** Supprime un document et tout ce qui en dérive, puis purge les entités orphelines. */
  deleteDocument(docId) {
    const chunkIds = this.all('SELECT id FROM chunks WHERE doc_id=?', docId).map((r) => r.id);
    for (const id of chunkIds) this.run('DELETE FROM chunks_fts WHERE rowid=?', id);
    this.run('DELETE FROM documents WHERE id=?', docId); // cascade chunks, relations, mentions, links
  }

  purgeOrphans() {
    // entités non verrouillées sans mention ni relation ni note d'origine
    const rows = this.all(`
      SELECT e.id FROM entities e WHERE e.locked=0
        AND (e.doc_id IS NULL OR NOT EXISTS (SELECT 1 FROM documents d WHERE d.id=e.doc_id))
        AND NOT EXISTS (SELECT 1 FROM mentions m WHERE m.entity_id=e.id)
        AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.subj=e.id OR r.obj=e.id)`);
    for (const r of rows) {
      this.run('DELETE FROM entities_fts WHERE rowid=?', r.id);
      this.run('DELETE FROM entities WHERE id=?', r.id);
    }
    return rows.length;
  }

  close() {
    this._stmts.clear();
    this.db.close();
  }
}

module.exports = { Store };
