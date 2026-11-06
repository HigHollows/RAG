'use strict';
// Exports (GraphML, JSON, CSV, Markdown) et notes générées dans <coffre>/_graph/.

const fs = require('fs');
const path = require('path');

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function exportGraph(core, format) {
  const s = core.store;
  const ents = s.all('SELECT id, name, type, community_id, description FROM entities ORDER BY id');
  const rels = s.all('SELECT r.id, r.subj, r.obj, r.pred, r.confidence, r.quote, r.origin, d.path AS note FROM relations r LEFT JOIN chunks c ON c.id=r.chunk_id LEFT JOIN documents d ON d.id=c.doc_id ORDER BY r.id');
  if (format === 'json') return JSON.stringify({ entities: ents, relations: rels, communities: s.all('SELECT id, title, summary, size FROM communities WHERE level=0') }, null, 2);
  if (format === 'graphml') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
<key id="name" for="node" attr.name="name" attr.type="string"/><key id="type" for="node" attr.name="type" attr.type="string"/>
<key id="community" for="node" attr.name="community" attr.type="int"/>
<key id="pred" for="edge" attr.name="predicate" attr.type="string"/><key id="conf" for="edge" attr.name="confidence" attr.type="double"/>
<graph id="G" edgedefault="directed">
${ents.map((e) => `<node id="n${e.id}"><data key="name">${esc(e.name)}</data><data key="type">${esc(e.type)}</data><data key="community">${e.community_id ?? -1}</data></node>`).join('\n')}
${rels.map((r) => `<edge source="n${r.subj}" target="n${r.obj}"><data key="pred">${esc(r.pred)}</data><data key="conf">${r.confidence}</data></edge>`).join('\n')}
</graph></graphml>`;
  }
  if (format === 'csv') {
    const names = new Map(ents.map((e) => [e.id, e.name]));
    return (
      'ENTITES\nid,nom,type,communaute\n' + ents.map((e) => [e.id, csv(e.name), e.type, e.community_id ?? ''].join(',')).join('\n') +
      '\n\nRELATIONS\nid,sujet,predicat,objet,confiance,origine,note,phrase_source\n' +
      rels.map((r) => [r.id, csv(names.get(r.subj)), r.pred, csv(names.get(r.obj)), r.confidence, r.origin, csv(r.note), csv(r.quote)].join(',')).join('\n')
    );
  }
  if (format === 'md') {
    const names = new Map(ents.map((e) => [e.id, e.name]));
    return `# Export du graphe\n\n${ents.length} entités, ${rels.length} relations.\n\n## Communautés\n\n` +
      core.communityList().map((c) => `### ${c.title}\n${c.summary}\n`).join('\n') +
      '\n## Relations\n\n' + rels.map((r) => `- ${names.get(r.subj)} —${r.pred}→ ${names.get(r.obj)}${r.quote ? ` : « ${r.quote} »` : ''}`).join('\n');
  }
  throw new Error('Format inconnu : ' + format);
}

const safe = (s) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sans titre';

/** Écrit uniquement dans <coffre>/_graph/ ; ne touche jamais aux notes existantes. */
function writeGraphNotes(core) {
  const s = core.store;
  for (const v of core.config.data.vaults) {
    if (v.writeGraphNotes === false || !fs.existsSync(v.path)) continue;
    const dir = path.join(v.path, '_graph');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'Communautés'), { recursive: true });
    const head = '> Page générée automatiquement par GraphRAG Studio. Ne pas modifier : elle est régénérée à chaque ingestion.\n\n';
    const noteTitle = new Map(s.all('SELECT id, title FROM documents WHERE vault=?', v.name).map((d) => [d.id, d.title]));

    const ents = s.all("SELECT e.id, e.name, e.type, e.doc_id, e.description FROM entities e WHERE e.doc_id IS NULL OR e.doc_id IN (SELECT id FROM documents WHERE vault=?) ORDER BY e.type, e.name", v.name);
    const byType = new Map();
    ents.forEach((e) => { if (!byType.has(e.type)) byType.set(e.type, []); byType.get(e.type).push(e); });
    let idx = head + '# Index des entités\n\n';
    for (const [t, list] of byType) {
      idx += `## ${t} (${list.length})\n` + list.map((e) => `- ${e.doc_id && noteTitle.get(e.doc_id) ? `[[${noteTitle.get(e.doc_id)}]]` : e.name}${e.description && !e.doc_id ? ' — ' + e.description : ''}`).join('\n') + '\n\n';
    }
    fs.writeFileSync(path.join(dir, 'Index des entités.md'), idx);

    for (const c of core.communityList()) {
      const members = s.all('SELECT name, doc_id FROM entities WHERE community_id=? ORDER BY name', c.id);
      fs.writeFileSync(path.join(dir, 'Communautés', safe(c.title) + ' (' + c.id + ').md'),
        head + `# ${c.title}\n\n${c.summary}\n\n## Éléments\n` + members.map((m) => `- ${m.doc_id && noteTitle.get(m.doc_id) ? `[[${noteTitle.get(m.doc_id)}]]` : m.name}`).join('\n') + '\n');
    }
    const last = s.get("SELECT * FROM jobs WHERE type='ingest' ORDER BY id DESC LIMIT 1");
    const st = last ? JSON.parse(last.stats || '{}') : {};
    fs.writeFileSync(path.join(dir, "Rapport d'ingestion.md"), head + `# Rapport d'ingestion\n\n- Date : ${last?.ended || ''}\n- Notes ajoutées : ${st.added ?? 0}, modifiées : ${st.modified ?? 0}, supprimées : ${st.deleted ?? 0}\n- Entités : ${st.entities ?? 0}, relations : ${st.relations ?? 0}\n- Liens cassés : ${st.brokenLinks ?? 0}\n- Appels LLM : ${st.llmCalls ?? 0} (cache : ${st.cacheHits ?? 0}), coût : ${(st.cost ?? 0).toFixed(4)} $\n` +
      (s.all("SELECT payload FROM review WHERE kind='broken_link' AND status='open' LIMIT 50").map((r) => JSON.parse(r.payload)).map((p) => `- Lien cassé : [[${p.from.replace(/\.md$/, '')}]] → ${p.target}`).join('\n')));
  }
}

module.exports = { exportGraph, writeGraphNotes };
