'use strict';
// Registre unique des méthodes exposées à l'interface (IPC) et à l'API HTTP. Aucune logique métier ici.

const { exportGraph } = require('./core/exporter');
const { runEval } = require('./core/evaluate');

const METHODS = {
  status: { run: (c) => c.status() },
  costs: { run: (c) => c.costs() },
  jobs: { run: (c) => c.jobs() },
  estimate: { run: (c, o) => c.estimate(o || {}) },
  ingest: { run: (c, o) => c.ingest(o || {}) },
  cancelIngest: { run: (c) => c.cancelIngest() },
  rebuild: { run: (c) => c.rebuild() },
  ask: { run: (c, q, o) => c.ask(q, o || {}) },
  searchEntities: { run: (c, q, n) => c.searchEntities(q, n) },
  entity: { run: (c, ref) => c.entity(ref) },
  note: { run: (c, ref) => c.note(ref) },
  noteList: { run: (c, q) => c.noteList(q) },
  chunk: { run: (c, id) => c.chunk(id) },
  path: { run: (c, a, b) => c.path(a, b) },
  communities: { run: (c) => c.communityList() },
  graph: { run: (c, f) => c.graph(f || {}) },
  reviews: { run: (c, s) => c.reviews(s) },
  correct: { run: (c, a, args) => c.correct(a, args) },
  resolveReview: { run: (c, id, d) => c.resolveReview(id, d) },
  exportCorrections: { run: (c) => c.exportCorrections() },
  importCorrections: { run: (c, l) => c.importCorrections(l) },
  exportGraph: { run: (c, f) => exportGraph(c, f) },
  getSettings: { run: (c) => c.getSettings() },
  setSettings: { run: (c, p) => c.setSettings(p), http: false },
  evaluate: { run: (c, q) => runEval(c, q) },
};

module.exports = { METHODS };
