'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Core } = require('../src/core/core');
const { exportGraph } = require('../src/core/exporter');
const { cleanMd } = require('../src/core/answer');

const FIXTURE = path.join(__dirname, 'fixtures', 'vault_test');
const KNOWN = ['Claire Dubois', 'Marc Lefèvre', 'Projet Phoenix', 'Nordtech', 'Migration Cloud', 'Sophie Martin'];

/** LLM simulé : déterministe, n'appelle jamais l'API. */
function makeTransport(counter) {
  return async ({ prompt, system }) => {
    counter.n++;
    if (system.includes('Tu extrais')) {
      const text = /<texte>\n([\s\S]*?)\n<\/texte>/.exec(prompt)[1];
      const found = KNOWN.filter((k) => text.includes(k) || text.includes(`[[${k}`));
      const entities = found.map((name) => ({ name, type: name.startsWith('Projet') || name === 'Migration Cloud' ? 'Projet' : name === 'Nordtech' ? 'Organisation' : 'Personne', description: `${name} (test)` }));
      const relations = [];
      if (found.length >= 2) {
        const line = text.split('\n').find((l) => l.includes(found[0]) && l.includes(found[1])) || text.split('\n').find((l) => l.includes(found[0]));
        if (line) relations.push({ subject: found[0], predicate: 'lié_à', object: found[1], quote: line.slice(0, 80).trim(), confidence: 0.8 });
        relations.push({ subject: found[0], predicate: 'lié_à', object: found[1], quote: 'phrase totalement inventée jamais écrite', confidence: 0.9 });
      }
      return { text: JSON.stringify({ entities, relations }), usage: { in: 500, out: 120 } };
    }
    if (prompt.startsWith('Résume')) return { text: 'Résumé de test de la communauté.', usage: { in: 200, out: 30 } };
    return { text: 'Réponse de test [1] avec une citation fantôme [42].', usage: { in: 800, out: 40 } };
  };
}

function setup({ llm = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grag-'));
  const vault = path.join(tmp, 'vault');
  fs.cpSync(FIXTURE, vault, { recursive: true });
  const counter = { n: 0 };
  const core = new Core(path.join(tmp, 'data'), { transport: llm ? makeTransport(counter) : undefined });
  core.config.update({ vaults: [{ name: 'Test', path: vault, exclude: [], writeGraphNotes: true }] });
  if (!llm) core.config.data.llm.enabled = false;
  return { core, vault, tmp, counter };
}
const done = (core, tmp) => { core.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* fichier encore verrouillé par Windows */ } };

test('ingestion hors-ligne : graphe structurel complet sans clé API', async () => {
  const { core, tmp } = setup({ llm: false });
  const r = await core.ingest();
  assert.equal(r.errors.length, 0);
  assert.equal(r.llmCalls, 0);
  assert.equal(r.added, 35);
  assert.equal(r.brokenLinks, 1, 'seul [[Personne inconnue]] est cassé (code, images, liens internes ignorés)');
  const docs = core.store.all('SELECT path FROM documents').map((d) => d.path);
  assert.ok(!docs.some((p) => p.startsWith('.obsidian') || p.startsWith('_graph')));
  assert.equal(core.store.all("SELECT * FROM entities WHERE norm LIKE 'budget 2025%'").length, 2, 'doublon de nom = deux nœuds');
  const p = core.entity('Projet Phoenix');
  assert.ok(p.relations.some((x) => x.object === 'Migration Cloud' || x.subject === 'Migration Cloud'));
  assert.ok(p.relations.some((x) => x.subject === 'Réunion 2024-11-05' || x.object === 'Réunion 2024-11-05'), 'lien par alias [[Phoenix]]');
  const rels = core.store.all("SELECT r.quote, c.text FROM relations r JOIN chunks c ON c.id=r.chunk_id WHERE r.origin IN ('wiki','mention')");
  assert.ok(rels.length > 40);
  for (const x of rels) assert.ok(x.quote.length > 0 && x.text.replace(/\s+/g, ' ').includes(x.quote.replace(/\s+/g, ' ').slice(0, 20)), 'phrase source: ' + x.quote);
  assert.ok(core.status().communities >= 2);
  done(core, tmp);
});

test('incrémental : 2e passe sans appel LLM, modification ciblée, suppression en cascade', async () => {
  const { core, vault, tmp, counter } = setup();
  const first = await core.ingest();
  assert.ok(first.llmCalls > 20);
  assert.equal(first.pendingExtraction, 0);
  const callsAfterFirst = counter.n;

  const again = await core.ingest();
  assert.equal(counter.n, callsAfterFirst, 'aucune requête LLM sans changement');
  assert.equal(again.added + again.modified + again.deleted, 0);

  fs.appendFileSync(path.join(vault, 'Personnes', 'Sophie Martin.md'), '\n## Ajout\nSophie Martin travaille avec Claire Dubois sur un nouveau programme.\n');
  const before = counter.n;
  const mod = await core.ingest();
  assert.equal(mod.modified, 1);
  const delta = counter.n - before;
  assert.ok(delta >= 1 && delta <= 4, `appels LLM après modification : ${delta}`);

  const llmRels = core.store.all("SELECT r.quote, c.text FROM relations r JOIN chunks c ON c.id=r.chunk_id WHERE r.origin='llm'");
  assert.ok(llmRels.length > 5);
  for (const x of llmRels) {
    assert.ok(!x.quote.includes('inventée'), 'citation inventée rejetée');
    assert.ok(x.text.includes(x.quote));
  }

  fs.unlinkSync(path.join(vault, 'Divers', 'Recettes.md'));
  const del = await core.ingest();
  assert.equal(del.deleted, 1);
  assert.equal(core.store.get("SELECT COUNT(*) c FROM documents WHERE path='Divers/Recettes.md'").c, 0);
  assert.equal(core.store.get("SELECT COUNT(*) c FROM entities WHERE norm='recettes'").c, 0);
  done(core, tmp);
});

test('dry-run : estimation sans aucun appel', async () => {
  const { core, tmp, counter } = setup();
  const e = await core.estimate();
  assert.equal(counter.n, 0);
  assert.equal(e.added, 35);
  assert.ok(e.chunks > 20 && e.cost > 0);
  done(core, tmp);
});

test('questions : citations réelles, refus hors-corpus, chemin, global', async () => {
  const { core, tmp } = setup();
  await core.ingest();
  const r = await core.ask('Qui dirige le Projet Phoenix ?');
  assert.ok(r.citations.length >= 1);
  assert.ok(!r.answer.includes('[42]'), 'citation fantôme supprimée');
  assert.ok(/\[1\]/.test(r.answer));
  for (const c of r.citations) assert.ok(cleanMd(core.chunk(c.chunkId).text).includes(c.excerpt.replace(/…$/, '')));

  const off = await core.ask('Qui dirige le Projet Phoenix ?', { forceOffline: true });
  assert.ok(off.offline && off.citations.length >= 1);

  const none = await core.ask('Quelle est la capitale de la Mongolie et sa population ?');
  assert.ok(none.noEvidence, 'pas de preuve, pas de réponse');

  const p = await core.ask('Quel est le lien entre Sophie Martin et Nordtech ?');
  assert.equal(p.mode, 'path');
  assert.ok(p.path.found && p.path.nodes.length >= 3);

  const g = await core.ask('Quels thèmes reviennent dans mes notes ?');
  assert.equal(g.mode, 'global');
  assert.ok(g.communities.length >= 1);
  done(core, tmp);
});

test('corrections manuelles persistantes à la ré-ingestion et à la reconstruction', async () => {
  const { core, vault, tmp } = setup();
  await core.ingest();
  const marc = core.entity('Marc Lefèvre');
  core.correct('rename', { id: marc.id, name: 'Marc L.' });
  assert.ok(core.entity('Marc L.'));
  fs.appendFileSync(path.join(vault, 'Personnes', 'Claire Dubois.md'), '\nClaire Dubois discute avec Marc Lefèvre.\n');
  await core.ingest();
  assert.equal(core.store.get("SELECT COUNT(*) c FROM entities WHERE name='Marc Lefèvre'").c, 0, "pas de recréation de l'entité renommée");
  assert.equal(core.store.get('SELECT locked FROM entities WHERE name=?', 'Marc L.').locked, 1);

  const sport = core.entity('Sport'), sommeil = core.entity('Sommeil');
  assert.throws(() => core.correct('merge', { into: sport.id, from: sommeil.id }), /deux notes/);

  core.correct('delete', { id: core.entity('Productivité').id });
  await core.rebuild();
  assert.equal(core.store.get("SELECT COUNT(*) c FROM entities WHERE norm='productivite'").c, 0, 'la suppression survit à la reconstruction');
  assert.ok(core.entity('Marc L.'), 'le renommage survit à la reconstruction');
  done(core, tmp);
});

test('notes _graph générées, vault intact, exports, arrêt sur budget', async () => {
  const { core, vault, tmp } = setup();
  const snap = (d) => fs.readdirSync(d, { recursive: true }).filter((f) => f.endsWith('.md') && !f.startsWith('_graph')).map((f) => [f, fs.readFileSync(path.join(d, f), 'utf8')]);
  const before = snap(vault);
  await core.ingest();
  assert.deepEqual(snap(vault), before, 'aucune note existante modifiée');
  assert.ok(fs.existsSync(path.join(vault, '_graph', 'Index des entités.md')));
  const g = exportGraph(core, 'graphml');
  assert.ok(g.includes('<graphml') && g.includes('Projet Phoenix'));
  assert.ok(JSON.parse(exportGraph(core, 'json')).entities.length > 20);
  assert.ok(exportGraph(core, 'csv').startsWith('ENTITES'));

  core.config.data.llm.budgetPerJob = 0.0000001;
  fs.appendFileSync(path.join(vault, 'Divers', 'Idées.md'), '\nNouvelle idée avec Nordtech et Marc Lefèvre.\n');
  const r = await core.ingest();
  assert.ok(r.errors.some((e) => /Budget/.test(e)), "arrêt propre à l'atteinte du budget");
  done(core, tmp);
});

test('MCP : outils exposés en JSON-RPC stdio', async () => {
  const { core, tmp } = setup({ llm: false });
  await core.ingest();
  core.close();
  const { spawn } = require('child_process');
  const mcp = path.join(__dirname, '..', 'src', 'mcp.js').replace(/\\/g, '/');
  const p = spawn(process.execPath, ['-e', `require(${JSON.stringify(mcp)}).startMcp(${JSON.stringify(path.join(tmp, 'data'))})`]);
  const out = [];
  p.stdout.on('data', (d) => out.push(...d.toString().split('\n').filter(Boolean)));
  const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_knowledge', arguments: { question: 'Qui est Claire Dubois ?' } } });
  await new Promise((r) => setTimeout(r, 2000));
  p.stdin.end();
  const msgs = out.map((l) => JSON.parse(l));
  assert.equal(msgs.find((m) => m.id === 2).result.tools.length, 6);
  const call = msgs.find((m) => m.id === 3).result;
  assert.ok(call.content[0].text.includes('Sources'));
  assert.ok(call.structuredContent.citations.length >= 1);
  await new Promise((r) => p.on('close', r));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* verrou Windows */ }
});
