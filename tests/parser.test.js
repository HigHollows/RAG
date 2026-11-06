'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseNote, buildResolver, parseFrontmatter } = require('../src/core/obsidian');
const { chunkNote, mergeTiny } = require('../src/core/chunker');
const { validateExtraction } = require('../src/core/extract');
const { louvain } = require('../src/core/graph');
const { verifyCitations } = require('../src/core/answer');

test('frontmatter : scalaires, listes inline et multi-lignes', () => {
  const { data } = parseFrontmatter('---\ntitle: "Un titre"\naliases: [A, B]\ntags:\n  - x\n  - y/z\ndate: 2025-01-01\nn: 3\n---\ncorps');
  assert.equal(data.title, 'Un titre');
  assert.deepEqual(data.aliases, ['A', 'B']);
  assert.deepEqual(data.tags, ['x', 'y/z']);
  assert.equal(data.n, 3);
});

test('wikilinks : alias, section, bloc, embed ; code ignoré', () => {
  const n = parseNote('# T\n[[Note A]] [[Note B|alias]] [[Note C#Sec]] [[Note D#^bloc]] ![[Note E]] ![[img.png]]\n`[[inline]]`\n```\n[[code]] #nope\n```\n[[#interne]]', 'T.md');
  const t = n.links.map((l) => [l.target, l.section, l.alias, l.embed]);
  assert.deepEqual(t.filter((x) => x[0]).map((x) => x[0]), ['Note A', 'Note B', 'Note C', 'Note D', 'Note E', 'img.png']);
  assert.equal(n.links.find((l) => l.target === 'Note B').alias, 'alias');
  assert.equal(n.links.find((l) => l.target === 'Note C').section, 'Sec');
  assert.equal(n.links.find((l) => l.target === 'Note D').section, '^bloc');
  assert.equal(n.links.find((l) => l.target === 'Note E').embed, true);
  assert.ok(!n.links.some((l) => ['inline', 'code'].includes(l.target)));
  assert.ok(!n.tags.includes('nope'));
});

test('tags imbriqués dans le corps et le frontmatter, pas de tag dans un titre', () => {
  const n = parseNote('---\ntags: [a, b]\n---\n# Titre\ntexte #santé/sommeil et #projet. Lien [[X#y]] #123', 'x.md');
  assert.deepEqual(n.tags.sort(), ['a', 'b', 'projet', 'santé/sommeil']);
});

test('résolution : nom, alias, casse, doublons (même dossier prioritaire)', () => {
  const notes = [
    { path: 'a/Budget.md', basename: 'Budget', aliases: [] },
    { path: 'b/Budget.md', basename: 'Budget', aliases: [] },
    { path: 'p/Personne.md', basename: 'Personne', aliases: ['Claire'] },
  ];
  const r = buildResolver(notes);
  assert.equal(r('budget', 'b/x.md').path, 'b/Budget.md');
  assert.equal(r('claire').path, 'p/Personne.md');
  assert.equal(r('inexistant'), null);
});

test('chunking : chemin de titres, taille bornée, offsets', () => {
  const body = '# Doc\n\n## A\n' + 'mot '.repeat(1500) + '\n\n## B\ncourt texte ici\n';
  const note = parseNote(body, 'doc.md');
  const chunks = chunkNote(note, { targetTokens: 300, overlap: 0.1 });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.tokens <= 330));
  assert.ok(chunks.some((c) => c.headingPath === 'doc > Doc > A'));
  assert.ok(mergeTiny(chunks).length <= chunks.length);
});

test('extraction : une relation sans phrase source vérifiable est rejetée', () => {
  const cfg = { entityTypes: ['Personne', 'Autre'], relationTypes: ['lié_à', 'travaille_avec'], minConfidence: 0.5 };
  const text = 'Claire travaille avec Marc sur le projet.';
  const r = validateExtraction({ entities: [{ name: 'Claire', type: 'Personne' }, { name: 'Marc', type: 'Inconnu' }], relations: [
    { subject: 'Claire', predicate: 'travaille_avec', object: 'Marc', quote: 'Claire travaille avec Marc', confidence: 0.9 },
    { subject: 'Claire', predicate: 'travaille_avec', object: 'Marc', quote: 'phrase inventée absente', confidence: 0.9 },
    { subject: 'Claire', predicate: 'lié_à', object: 'Marc', quote: 'Claire travaille avec Marc', confidence: 0.1 },
  ] }, text, cfg);
  assert.equal(r.relations.length, 1);
  assert.equal(r.rejected, 2);
  assert.equal(r.entities.find((e) => e.name === 'Marc').type, 'Autre');
});

test('louvain : deux cliques reliées par un pont → 2 communautés, déterministe', () => {
  const e = [];
  const clique = (a) => { for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) e.push([a + i, a + j, 1]); };
  clique(0); clique(5); e.push([0, 5, 1]);
  const l1 = louvain(10, e); const l2 = louvain(10, e);
  assert.deepEqual(l1, l2);
  const last = l1[l1.length - 1];
  assert.equal(new Set(last).size, 2);
  assert.equal(new Set(last.slice(0, 5)).size, 1);
});

test('citations : les numéros inexistants sont retirés', () => {
  const v = verifyCitations('A [1] B [7] C [2][9].', [{ n: 1 }, { n: 2 }]);
  assert.equal(v.text, 'A [1] B  C [2].');
  assert.deepEqual(v.used, [1, 2]);
  assert.equal(v.invalid, 2);
});
