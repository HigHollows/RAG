'use strict';
// Script ponctuel utilisé pour la refonte v3 de l'interface (conservé pour mémoire).
const fs = require('fs');
let s = fs.readFileSync('src/ui/app.js', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('introuvable: ' + a.slice(0, 70)); s = s.replace(a, b); };
const cut = (from, to, repl) => { const i = s.indexOf(from), j = s.indexOf(to, i); if (i < 0 || j < 0) throw new Error('bornes: ' + from.slice(0, 40)); s = s.slice(0, i) + repl + s.slice(j); };

cut('function renderNav() {', 'async function go(', `function renderNav() {
  const s = state.status;
  const busy = s && s.progress && s.progress.running;
  const mk = (id, label) => h('button', { class: 'item', 'aria-current': state.page === id ? 'page' : null, onclick: () => go(id) }, label,
    id === 'review' && s && s.review ? h('span', { class: 'badge', 'aria-label': s.review + ' éléments à revoir' }, s.review) : null);
  $('#nav').replaceChildren(...[
    h('div', { class: 'brand' }, 'GraphRAG', h('span', null, 'Studio')),
    h('div', { class: 'group' }, 'Savoir'), mk('chat', 'Questions'), mk('graph', 'Graphe'), mk('explore', 'Explorateur'),
    h('div', { class: 'group' }, 'Gestion'), mk('review', 'Revue'), mk('ingest', 'Ingestion'), mk('settings', 'Réglages'),
    h('div', { class: 'spacer' }),
    s ? h('div', { class: 'statusbox', id: 'statusbox' },
      h('div', null, h('b', null, fmtNum(s.documents)), ' notes'),
      h('div', null, h('b', null, fmtNum(s.entities)), ' entités'),
      h('div', null, h('b', null, fmtNum(s.relations)), ' relations'),
      h('div', { class: 'pill ' + (busy ? 'busy' : s.llm.available ? 'on' : '') }, h('i'),
        busy ? (s.progress.step || 'Traitement') + (s.progress.total ? ' ' + s.progress.done + '/' + s.progress.total : '…') : s.llm.available ? 'Claude connecté' : 'Hors-ligne')) : null,
  ].filter(Boolean));
}

`);

rep("const SUGGESTIONS = [['Vue d’ensemble', 'Quels sont les thèmes principaux de mes notes ?'], ['Personnes', 'Quelles personnes reviennent le plus souvent ?'], ['Synthèse', 'Résume mes notes les plus récentes']];",
    "const SUGGESTIONS = [['Thèmes', 'Quels sont les thèmes principaux de mes notes ?'], ['Personnes', 'Quelles personnes reviennent le plus souvent ?'], ['Synthèse', 'Résume mes notes les plus récentes']];");
cut("    return h('div', { class: 'hero' }", '  async function submit()', `    return h('div', { class: 'intro' },
      h('div', { class: 'eyebrow' }, 'Pour commencer'),
      h('div', null, SUGGESTIONS.map(([k, q]) => h('button', { class: 'try', onclick: () => { ta.value = q; submit(); } }, h('small', null, k), q))),
      s.llm.available ? null : h('p', { class: 'small muted', style: 'margin-top:20px' }, 'Mode hors-ligne : les réponses sont des passages cités. Ajoutez une clé API dans Réglages pour obtenir des réponses rédigées.'));
  }

`);
rep("return h('div', { class: 'empty' }, h('h1', null, 'Bienvenue dans GraphRAG Studio'),\n        h('p', { class: 'sub' }, 'Reliez votre coffre Obsidian : l’application en extrait un graphe de connaissances et répond à vos questions avec des sources vérifiables.'),",
    "return h('div', { class: 'intro' }, h('div', { class: 'eyebrow' }, 'Bienvenue'),\n        h('p', { class: 'lead' }, 'Reliez votre coffre Obsidian : l’application en extrait un graphe de connaissances et répond à vos questions avec des sources vérifiables.'),");
rep("h('p', { class: 'small muted', style: 'margin-top:16px' }, 'Vos notes ne sont jamais modifiées. Tout est stocké localement.'));", "h('p', { class: 'small muted', style: 'margin-top:14px' }, 'Vos notes ne sont jamais modifiées. Tout est stocké localement.'));");
rep("return h('div', { class: 'empty' }, h('h1', null, 'Prêt à analyser vos notes'), h('p', { class: 'sub' }, 'Lancez une première ingestion pour construire le graphe.'),",
    "return h('div', { class: 'intro' }, h('div', { class: 'eyebrow' }, 'Prêt'), h('p', { class: 'lead' }, 'Lancez une première ingestion pour construire le graphe de vos notes.'),");

rep("placeholder: 'Posez une question sur vos notes…'", "placeholder: 'Poser une question sur vos connaissances…'");
rep("[['auto', 'Mode : auto'], ['local', 'Local (précis)'], ['global', 'Global (thèmes)'], ['path', 'Chemin entre 2 entités'], ['note', 'Note précise']]", "[['auto', 'Mode automatique'], ['local', 'Recherche locale'], ['global', 'Vue d’ensemble'], ['path', 'Chemin entre deux entités'], ['note', 'Note précise']]");
rep("h('div', { class: 'conv' }, msgs,", "h('div', { class: 'conv' }, h('div', { class: 'head' }, h('div', null, h('h1', null, 'Questions'), h('p', { class: 'sub' }, 'Interrogez votre base de connaissances.'))), msgs,");
rep("}, 'Effacer') : null, sendBtn", "}, 'Effacer la conversation') : null, sendBtn");

rep("h('div', { class: 'msg a' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, svg(ICON.graph)), bubble)", "h('div', { class: 'msg a' }, bubble)");
cut("        bubble.append(h('div', { class: 'meta' },", "      }\n      msgs.append(h('div', { class: 'msg a' }", `        bubble.append(h('div', { class: 'meta' },
          h('span', { class: 'chip' }, { local: 'Recherche locale', global: 'Vue d’ensemble', path: 'Chemin', note: 'Note' }[r.mode] || r.mode),
          r.offline ? h('span', { class: 'chip warn', title: 'Aucune clé API : passages extraits sans reformulation' }, 'Hors-ligne') : null,
          r.noEvidence ? h('span', { class: 'chip bad' }, 'Aucune preuve dans vos notes') : null,
          r.stats && r.stats.cited ? h('span', { class: 'chip' }, r.stats.cited + ' source' + (r.stats.cited > 1 ? 's' : '') + ' vérifiée' + (r.stats.cited > 1 ? 's' : '')) : null,
          r.stats && r.stats.invalid ? h('span', { class: 'chip warn', title: 'Numéros de source inexistants retirés' }, r.stats.invalid + ' référence invalide retirée') : null,
          h('button', { class: 'sm ghost', onclick: () => { state.selected = i; renderMsgs(); renderSide(); } }, 'Afficher les sources')));
`);
rep("side.append(h('h2', null, 'Sources (' + r.citations.length + ')'));", "side.append(h('h2', null, 'Sources'));");
rep("typeColor = (t) => (TYPE_COLORS[t] ||= `hsl(${(Object.keys(TYPE_COLORS).length * 137.5 + 200) % 360} 60% 55%)`);", "typeColor = (t) => (TYPE_COLORS[t] ||= window.GraphView.palette(Object.keys(TYPE_COLORS).length + 1));");
fs.writeFileSync('src/ui/app.js', s);

let g = fs.readFileSync('src/ui/graphview.js', 'utf8');
g = g.replace("static palette(i) { return `hsl(${(i * 137.508) % 360} 62% 56%)`; }", "static palette(i) { return ['#526B5B', '#6F86A0', '#B08D57', '#A5675C', '#7D6B8A', '#5F8A8B', '#9A8F6B', '#8C7D74', '#6B7F5E', '#A07A8E'][Math.abs(i) % 10]; }");
g = g.replace("n.community ? GraphView.palette(n.community) : '#8a93a3'", "n.community ? GraphView.palette(n.community) : '#B5B5B0'");
fs.writeFileSync('src/ui/graphview.js', g);
console.log('patch ok');
