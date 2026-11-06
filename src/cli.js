#!/usr/bin/env node
'use strict';
// CLI : node src/cli.js <commande> [options]   (ou ELECTRON_RUN_AS_NODE=1 "GraphRAG Studio.exe" cli.js …)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Core } = require('./core/core');
const { exportGraph } = require('./core/exporter');

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) o[k] = true;
      else { o[k] = next; i++; }
    } else o._.push(a);
  }
  return o;
}

const HELP = `GraphRAG Studio — CLI
  init --vault <chemin> [--name <nom>]   déclare un coffre
  ingest [--dry-run] [--full]            ingestion (incrémentale par défaut)
  status                                 état de la base et coûts
  ask "question" [--mode auto|local|global|path|note] [--format texte|json] [--offline]
  entity <nom>        path <A> <B>       note <chemin>
  export --format graphml|json|csv|md [--out fichier]
  rebuild             eval <questions.json>
Options globales : --data <dossier>  (défaut : %APPDATA%/GraphRAG Studio)`;

async function main(argv) {
  const a = parse(argv);
  const cmd = a._.shift();
  if (!cmd || a.help) return console.log(HELP);
  const dataDir = a.data || process.env.GRAPHRAG_DATA || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'GraphRAG Studio');
  const core = new Core(dataDir);
  try {
    if (cmd === 'init') {
      if (a.vault) {
        const p = path.resolve(a.vault);
        if (!fs.existsSync(p)) throw new Error('Dossier introuvable : ' + p);
        core.config.update({ vaults: [...core.config.data.vaults.filter((v) => v.path !== p), { name: a.name || path.basename(p), path: p, exclude: [], writeGraphNotes: !a['no-graph-notes'] }] });
      }
      core.config.save();
      return console.log('Configuration : ' + core.config.file);
    }
    if (cmd === 'ingest') {
      if (a['dry-run']) {
        const e = await core.estimate({ full: !!a.full });
        return console.log(`Ajouts ${e.added}, modifications ${e.modified}, suppressions ${e.deleted}, inchangés ${e.unchanged}\nChunks à traiter : ${e.chunks}\nTokens estimés : ${e.tokensIn} entrée / ${e.tokensOut} sortie (${e.model})\nCoût estimé : ${e.cost.toFixed(3)} $${e.llmAvailable ? '' : '  (aucune clé API : extraction LLM ignorée, coût réel 0)'}`);
      }
      core.onEvent = (t, p) => { if (t === 'progress' && p.step) process.stderr.write(`\r${p.step} ${p.done || ''}/${p.total || ''} ${String(p.msg || '').slice(0, 50).padEnd(50)}`); };
      const r = await core.ingest({ full: !!a.full });
      process.stderr.write('\n');
      return console.log(JSON.stringify(r, null, 2));
    }
    if (cmd === 'status') return console.log(JSON.stringify(core.status(), null, 2));
    if (cmd === 'ask') {
      const r = await core.ask(a._.join(' '), { mode: a.mode, forceOffline: !!a.offline });
      if (a.format === 'json') return console.log(JSON.stringify(r, null, 2));
      console.log(r.answer + '\n');
      r.citations.forEach((c) => console.log(`[${c.n}] ${c.title} › ${c.section}\n    ${c.path}\n    ${c.uri}`));
      return;
    }
    if (cmd === 'entity') return console.log(JSON.stringify(core.entity(a._.join(' ')), null, 2));
    if (cmd === 'path') return console.log(JSON.stringify(core.path(a._[0], a._[1]), null, 2));
    if (cmd === 'note') { const n = core.note(a._.join(' ')); return console.log(n ? JSON.stringify({ ...n, chunks: undefined, summary: undefined }, null, 2) + '\n\n' + n.summary : 'Note introuvable'); }
    if (cmd === 'export') {
      const out = exportGraph(core, a.format || 'json');
      if (a.out) { fs.writeFileSync(a.out, out); return console.log('Écrit : ' + a.out); }
      return console.log(out);
    }
    if (cmd === 'rebuild') return console.log(JSON.stringify(await core.rebuild(), null, 2));
    if (cmd === 'eval') {
      const { runEval } = require('./core/evaluate');
      const r = await runEval(core, JSON.parse(fs.readFileSync(a._[0], 'utf8')));
      return console.log(r.markdown + '\n\nRapport : ' + r.report);
    }
    console.log(HELP);
  } finally {
    core.close();
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error('Erreur : ' + e.message); process.exit(1); });
module.exports = { main };
