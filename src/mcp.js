'use strict';
// Serveur MCP (stdio, JSON-RPC 2.0) sans dépendance. Lecture seule.
// Lancement : GraphRAG Studio.exe --mcp   (ou : ELECTRON_RUN_AS_NODE=1 <exe> <chemin>/mcp.js)

const { Core } = require('./core/core');

function startMcp(dataDir) {
  const core = new Core(dataDir);
  const fmtCitations = (cs) => cs.map((c) => `[${c.n}] ${c.title} — ${c.section} — ${c.path}\n    « ${c.excerpt} »\n    ${c.uri}`).join('\n');

  const tools = {
    search_knowledge: {
      description: "Interroge la base de connaissances (notes Obsidian) et renvoie une réponse sourcée avec citations. mode : auto|local|global|path|note.",
      schema: { type: 'object', properties: { question: { type: 'string' }, mode: { type: 'string', enum: ['auto', 'local', 'global', 'path', 'note'] } }, required: ['question'] },
      run: async (a) => {
        const r = await core.ask(a.question, { mode: a.mode });
        return { text: `${r.answer}\n\nSources :\n${fmtCitations(r.citations)}`, structured: { answer: r.answer, mode: r.mode, citations: r.citations, entities: r.entities } };
      },
    },
    get_entity: {
      description: "Fiche d'une entité : description, relations (avec phrase source), notes où elle apparaît.",
      schema: { type: 'object', properties: { nom: { type: 'string' } }, required: ['nom'] },
      run: async (a) => {
        const e = core.entity(a.nom);
        if (!e) return { text: 'Entité introuvable.' };
        return { text: `${e.name} (${e.type})\n${e.description}\nRelations :\n` + e.relations.slice(0, 30).map((r) => `- ${r.subject} —${r.predicate}→ ${r.object}${r.quote ? ` : « ${r.quote} »` : ''}`).join('\n') + '\nNotes : ' + e.notes.map((n) => n.path).join(', '), structured: e };
      },
    },
    find_path: {
      description: 'Plus court chemin entre deux entités, avec les phrases sources.',
      schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] },
      run: async (a) => {
        const p = core.path(a.a, a.b);
        if (!p.found) return { text: p.missing?.length ? `Introuvable : ${p.missing.join(', ')}` : 'Aucun chemin trouvé.' };
        return { text: p.nodes.map((n) => n.name).join(' → ') + '\n' + p.edges.map((e) => `- ${e.subject} —${e.predicate}→ ${e.object}${e.quote ? ` : « ${e.quote} »` : ''}`).join('\n'), structured: p };
      },
    },
    get_note: {
      description: "Contenu et métadonnées d'une note (titre, alias ou chemin).",
      schema: { type: 'object', properties: { chemin: { type: 'string' } }, required: ['chemin'] },
      run: async (a) => {
        const n = core.note(a.chemin);
        if (!n) return { text: 'Note introuvable.' };
        return { text: `# ${n.title}\n(${n.path})\nTags : ${n.tags.join(', ')}\n\n${n.summary}`, structured: { title: n.title, path: n.path, tags: n.tags, uri: n.uri, backlinks: n.backlinks } };
      },
    },
    list_communities: {
      description: 'Résumés des communautés thématiques du graphe, filtrables par mot-clé.',
      schema: { type: 'object', properties: { theme: { type: 'string' } } },
      run: async (a) => {
        const k = (a.theme || '').toLowerCase();
        const l = core.communityList().filter((c) => !k || (c.title + c.summary).toLowerCase().includes(k));
        return { text: l.map((c) => `## ${c.title} (${c.size})\n${c.summary}`).join('\n\n') || 'Aucune communauté.', structured: l };
      },
    },
    ingest_status: {
      description: "État de la base : documents, entités, dernière ingestion, coûts.",
      schema: { type: 'object', properties: {} },
      run: async () => { const s = core.status(); return { text: JSON.stringify({ documents: s.documents, entities: s.entities, relations: s.relations, communities: s.communities, lastIngest: s.lastIngest, pendingExtraction: s.pendingExtraction, costMonth: s.costMonth }, null, 2) }; },
    },
  };

  const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
  const handle = async (msg) => {
    const { id, method, params } = msg;
    try {
      if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'graphrag-studio', version: '1.0.0' } } });
      if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return;
      if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) } });
      if (method === 'tools/call') {
        const t = tools[params.name];
        if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Outil inconnu' } });
        try {
          const r = await t.run(params.arguments || {});
          return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.text }], structuredContent: r.structured } });
        } catch (e) {
          return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'Erreur : ' + e.message }] } });
        }
      }
      if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Méthode inconnue' } });
    } catch (e) {
      if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  };
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { handle(JSON.parse(line)); } catch { /* ligne invalide */ } }
    }
  });
  process.stdin.on('end', () => { core.close(); process.exit(0); });
}

module.exports = { startMcp };
