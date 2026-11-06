'use strict';
/* GraphRAG Studio — interface. Aucune logique métier : tout passe par window.app.call(...). */

// ───────────────────────── utilitaires
const api = (m, ...a) => window.app.call(m, ...a);
const $ = (s, r = document) => r.querySelector(s);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const ICON = {
  chat: 'M4 5h16v11H9l-5 4z', graph: 'M6 7a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4zM12 21a2 2 0 100-4 2 2 0 000 4zM7.5 6.5l3.7 11M16.5 6.5l-3.7 11M8 5h8',
  explore: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', review: 'M5 12l4 4L19 6', ingest: 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.400 7.400 0 000 2.400l-2 1.600 2 3.400 2.400-1a7.500 7.500 0 002 1.200l.4 2.600h4l.4-2.600a7.500 7.500 0 002-1.200l2.400 1 2-3.400-2-1.600c.1-.4.1-.8.1-1.200z',
};
const svg = (d, extra = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };

const money = (x) => (x < 0.01 && x > 0 ? '< 0,01 $' : x.toFixed(2).replace('.', ',') + ' $');
const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');
const fmtDate = (s) => (s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const TYPE_COLORS = {};
const typeColor = (t) => (TYPE_COLORS[t] ||= window.GraphView.palette(Object.keys(TYPE_COLORS).length + 1));

function toast(text, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 9000 : 4500);
}

async function guard(fn, label) {
  try { return await fn(); } catch (e) { toast((label ? label + ' : ' : '') + String(e.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, ''), 'error'); return undefined; }
}

function modal(title, body, buttons) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-label': title }, h('h2', null, title), body,
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' }, buttons.map((b) => h('button', { class: b.primary ? 'primary' : b.danger ? 'danger' : '', onclick: () => { dlg.close(); resolve(b.value); } }, b.label))));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(undefined); });
    document.body.append(dlg);
    dlg.showModal();
    const f = dlg.querySelector('input,select,textarea'); if (f) f.focus();
  });
}
const confirmDlg = async (title, text, ok = 'Confirmer', danger = false) => (await modal(title, h('p', null, text), [{ label: 'Annuler', value: false }, { label: ok, value: true, primary: !danger, danger }])) === true;
async function promptDlg(title, label, def = '') {
  const inp = h('input', { type: 'text', value: def, style: 'width:100%' });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('dialog').querySelector('button.primary').click(); });
  const r = await modal(title, h('label', { class: 'field' }, h('span', null, label), inp), [{ label: 'Annuler', value: null }, { label: 'Valider', value: 'ok', primary: true }]);
  return r === 'ok' ? inp.value.trim() : null;
}

// Markdown minimal et sûr (construit des nœuds DOM, jamais de HTML)
function inline(text, ctx = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`\n]+`|\[\[[^\]]+\]\]|\[\d+\](?:\[\d+\])*|\*[^*\n]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(h('strong', null, t.slice(2, -2)));
    else if (t.startsWith('`')) out.push(h('code', null, t.slice(1, -1)));
    else if (t.startsWith('[[')) {
      const [target, alias] = t.slice(2, -2).split('|');
      const name = target.split('#')[0];
      out.push(h('button', { class: 'chip accent', title: 'Ouvrir la note', onclick: () => go('explore', { tab: 'notes', note: name }) }, (alias || name).trim()));
    } else if (/^\[\d/.test(t)) {
      for (const n of t.match(/\d+/g)) out.push(h('button', { class: 'cite', 'aria-label': 'Source ' + n, onclick: () => ctx.onCite && ctx.onCite(Number(n)) }, n));
    } else out.push(h('em', null, t.slice(1, -1)));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function md(text, ctx) {
  const root = h('div', { class: 'md' });
  let list = null, para = [];
  const flush = () => { if (para.length) { root.append(h('p', null, inline(para.join(' '), ctx))); para = []; } };
  for (const raw of String(text).split('\n')) {
    const line = raw.trimEnd();
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (li) { flush(); if (!list) { list = h('ul'); root.append(list); } list.append(h('li', null, inline(li[1], ctx))); continue; }
    list = null;
    if (hd) { flush(); root.append(h('h4', null, inline(hd[2], ctx))); }
    else if (/^>\s?/.test(line)) { flush(); root.append(h('blockquote', null, inline(line.replace(/^>\s?/, ''), ctx))); }
    else if (!line.trim()) flush();
    else para.push(line);
  }
  flush();
  return root;
}

function highlightEntities(el, entities, onClick) {
  const names = entities.filter((e) => e.name.length >= 3).sort((a, b) => b.name.length - a.name.length).slice(0, 150);
  if (!names.length) return;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?<![\\p{L}\\p{N}])(' + names.map((n) => esc(n.name)).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
  const byName = new Map(names.map((n) => [n.name.toLowerCase(), n]));
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('button,mark,code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const tn of nodes) {
    const t = tn.nodeValue; re.lastIndex = 0;
    if (!re.test(t)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment(); let last = 0, m;
    while ((m = re.exec(t))) {
      frag.append(t.slice(last, m.index));
      const ent = byName.get(m[1].toLowerCase());
      frag.append(h('mark', { class: 'ent', tabindex: '0', title: ent ? ent.type : '', onclick: () => ent && onClick(ent), onkeydown: (e) => { if (e.key === 'Enter' && ent) onClick(ent); } }, m[1]));
      last = m.index + m[1].length;
    }
    frag.append(t.slice(last));
    tn.replaceWith(frag);
  }
}

// ───────────────────────── état et routage
const state = { page: 'chat', status: null, settings: null, params: {}, chat: [], selected: null };
const PAGES = [
  ['chat', 'Questions', ICON.chat], ['graph', 'Graphe', ICON.graph], ['explore', 'Explorer', ICON.explore],
  ['review', 'Revue', ICON.review], ['ingest', 'Ingestion', ICON.ingest], ['settings', 'Réglages', ICON.settings],
];
let cleanup = null;

async function refreshStatus() { state.status = await api('status'); renderNav(); return state.status; }

function renderNav() {
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

async function go(page, params = {}) {
  if (cleanup) { try { cleanup(); } catch { /* page déjà détruite */ } cleanup = null; }
  state.page = page; state.params = params;
  const main = $('#main'); main.replaceChildren();
  try { await refreshStatus(); } catch (e) { toast(e.message, 'error'); }
  const root = h('div', { class: 'page' + (page === 'chat' || page === 'graph' ? ' full' : '') });
  main.append(root);
  const fn = { chat: pageChat, graph: pageGraph, explore: pageExplore, review: pageReview, ingest: pageIngest, settings: pageSettings }[page];
  await guard(() => fn(root, params));
  main.scrollTop = 0;
}

// ───────────────────────── Questions
const SUGGESTIONS = [['Thèmes', 'Quels sont les thèmes principaux de mes notes ?'], ['Personnes', 'Quelles personnes reviennent le plus souvent ?'], ['Synthèse', 'Résume mes notes les plus récentes']];

async function addVault() {
  const p = await window.app.pickFolder();
  if (!p) return false;
  const s = await api('getSettings');
  const name = p.split(/[\\/]/).filter(Boolean).pop();
  if (s.vaults.some((v) => v.path === p)) { toast('Ce coffre est déjà configuré'); return false; }
  await api('setSettings', { vaults: [...s.vaults, { name, path: p, exclude: [], writeGraphNotes: true }] });
  toast('Coffre ajouté : ' + name, 'ok');
  return true;
}

async function pageChat(root) {
  const s = state.status;
  root.className = 'page full';
  const msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
  const side = h('aside', { class: 'side', 'aria-label': 'Sources' });
  const ta = h('textarea', { rows: 2, placeholder: 'Poser une question sur vos connaissances…', 'aria-label': 'Votre question' });
  const mode = h('select', { 'aria-label': 'Mode de recherche', title: 'Mode de recherche' },
    [['auto', 'Mode automatique'], ['local', 'Recherche locale'], ['global', 'Vue d’ensemble'], ['path', 'Chemin entre deux entités'], ['note', 'Note précise']].map(([v, l]) => h('option', { value: v }, l)));
  const sendBtn = h('button', { class: 'primary', onclick: submit }, 'Envoyer');
  let busy = false;

  function renderSide() {
    side.replaceChildren();
    const item = state.chat[state.selected];
    if (side.parentElement) side.parentElement.classList.toggle('nosrc', !(item && item.r));
    if (!item || !item.r) return;
    const r = item.r;
    side.append(h('h2', null, 'Sources'));
    if (r.path && r.path.found) side.append(h('div', { class: 'pathline', 'aria-label': 'Chemin' }, r.path.nodes.flatMap((n, i) => [i ? h('span', { class: 'muted' }, '→') : null, h('button', { class: 'chip accent', onclick: () => go('explore', { tab: 'entities', entity: n.id }) }, n.name)])));
    if (r.communities && r.communities.length) {
      side.append(h('h3', null, 'Thèmes'));
      r.communities.forEach((c) => side.append(h('div', { class: 'src' }, h('div', { class: 't' }, c.title), h('div', { class: 'small muted' }, c.size + ' éléments'), h('div', { class: 'row', style: 'margin-top:6px;gap:4px' }, c.members.slice(0, 6).map((m) => h('button', { class: 'chip', onclick: () => go('explore', { tab: 'entities', entity: m.id }) }, m.name))))));
    }
    r.citations.forEach((c) => side.append(h('div', { class: 'src', id: 'src-' + c.n, tabindex: '-1' },
      h('div', { class: 't' }, h('span', { class: 'num' }, c.n), c.title),
      h('div', { class: 'sec' }, c.section), h('div', { class: 'ex' }, c.excerpt),
      h('div', { class: 'row' },
        h('button', { class: 'sm ghost', onclick: () => window.app.openExternal(c.uri) }, 'Obsidian'),
        h('button', { class: 'sm ghost', onclick: () => showChunk(c.chunkId) }, 'Extrait'),
        h('button', { class: 'sm ghost', onclick: () => go('explore', { tab: 'notes', note: c.path }) }, 'Note')))));
    if (r.entities && r.entities.length) {
      side.append(h('h3', null, 'Entités liées'), h('div', { class: 'row', style: 'gap:6px' }, r.entities.map((e) => h('button', { class: 'chip', onclick: () => go('explore', { tab: 'entities', entity: e.id }) }, h('i', { class: 'dot', style: 'background:' + typeColor(e.type) }), e.name))));
    }
  }

  function renderMsgs() {
    msgs.replaceChildren();
    if (!state.chat.length) {
      msgs.append(welcome());
    }
    state.chat.forEach((it, i) => {
      msgs.append(h('div', { class: 'msg q' }, h('div', { class: 'bubble' }, it.q)));
      const bubble = h('div', { class: 'bubble' + (state.selected === i ? ' selected' : '') });
      it.el = bubble;
      if (it.pending) bubble.append(it.text ? h('span', { class: 'typing' }, it.text) : h('div', { class: 'skeleton', 'aria-label': 'Recherche en cours' }, h('i', { style: 'width:92%' }), h('i', { style: 'width:78%' }), h('i', { style: 'width:55%' })));
      else if (it.error) bubble.append(h('span', { style: 'color:var(--bad)' }, it.error));
      else if (it.r) {
        const r = it.r;
        bubble.append(md(r.answer, { onCite: (n) => { state.selected = i; renderMsgs(); renderSide(); const el = $('#src-' + n); if (el) { el.classList.add('hl'); el.scrollIntoView({ block: 'nearest' }); el.focus(); setTimeout(() => el.classList.remove('hl'), 1800); } } }));
        bubble.append(h('div', { class: 'meta' },
          h('span', { class: 'chip' }, { local: 'Recherche locale', global: 'Vue d’ensemble', path: 'Chemin', note: 'Note' }[r.mode] || r.mode),
          r.offline ? h('span', { class: 'chip warn', title: 'Aucune clé API : passages extraits sans reformulation' }, 'Hors-ligne') : null,
          r.noEvidence ? h('span', { class: 'chip bad' }, 'Aucune preuve dans vos notes') : null,
          r.stats && r.stats.cited ? h('span', { class: 'chip' }, r.stats.cited + ' source' + (r.stats.cited > 1 ? 's' : '') + ' vérifiée' + (r.stats.cited > 1 ? 's' : '')) : null,
          r.stats && r.stats.invalid ? h('span', { class: 'chip warn', title: 'Numéros de source inexistants retirés' }, r.stats.invalid + ' référence invalide retirée') : null,
          h('button', { class: 'sm ghost', onclick: () => { state.selected = i; renderMsgs(); renderSide(); } }, 'Afficher les sources')));
      }
      msgs.append(h('div', { class: 'msg a' }, bubble));
    });
    msgs.scrollTop = msgs.scrollHeight;
  }

  function welcome() {
    if (!s.vaults.length) {
      return h('div', { class: 'intro' }, h('div', { class: 'eyebrow' }, 'Bienvenue'),
        h('p', { class: 'lead' }, 'Reliez votre coffre Obsidian : l’application en extrait un graphe de connaissances et répond à vos questions avec des sources vérifiables.'),
        h('button', { class: 'primary', onclick: async () => { if (await guard(addVault)) go('ingest', { auto: true }); } }, 'Choisir mon coffre Obsidian…'),
        h('p', { class: 'small muted', style: 'margin-top:14px' }, 'Vos notes ne sont jamais modifiées. Tout est stocké localement.'));
    }
    if (!s.documents) {
      return h('div', { class: 'intro' }, h('div', { class: 'eyebrow' }, 'Prêt'), h('p', { class: 'lead' }, 'Lancez une première ingestion pour construire le graphe de vos notes.'),
        h('button', { class: 'primary', onclick: () => go('ingest', { auto: true }) }, 'Aller à l’ingestion'));
    }
    return h('div', { class: 'intro' },
      h('div', { class: 'eyebrow' }, 'Pour commencer'),
      h('div', null, SUGGESTIONS.map(([k, q]) => h('button', { class: 'try', onclick: () => { ta.value = q; submit(); } }, h('small', null, k), q))),
      s.llm.available ? null : h('p', { class: 'small muted', style: 'margin-top:20px' }, 'Mode hors-ligne : les réponses sont des passages cités. Ajoutez une clé API dans Réglages pour obtenir des réponses rédigées.'));
  }

  async function submit() {
    const q = ta.value.trim();
    if (!q || busy) return;
    busy = true; sendBtn.disabled = true; ta.value = '';
    const item = { q, pending: true, text: '' };
    state.chat.push(item); state.selected = state.chat.length - 1;
    renderMsgs(); renderSide();
    try { item.r = await api('ask', q, { mode: mode.value === 'auto' ? undefined : mode.value, stream: true }); }
    catch (e) { item.error = 'Erreur : ' + String(e.message).replace(/^Error invoking remote method '\w+': (Error: )?/, ''); }
    item.pending = false; busy = false; sendBtn.disabled = false;
    renderMsgs(); renderSide(); ta.focus();
  }

  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  const off = window.app.on((t, p) => {
    if (t === 'token') { const it = state.chat[state.chat.length - 1]; if (it && it.pending && it.el) { it.text += p; if (!it.el.querySelector('.typing')) it.el.replaceChildren(h('span', { class: 'typing' })); it.el.firstChild.textContent = it.text; msgs.scrollTop = msgs.scrollHeight; } }
  });
  cleanup = off;
  root.append(h('div', { class: 'chat' },
    h('div', { class: 'conv' }, h('div', { class: 'head' }, h('div', null, h('h1', null, 'Questions'), h('p', { class: 'sub' }, 'Interrogez votre base de connaissances.'))), msgs,
      h('div', { class: 'compose' }, h('div', { class: 'inner' }, h('div', { class: 'box' }, ta, h('div', { class: 'row', style: 'justify-content:space-between;padding:2px 4px' }, mode, h('div', { class: 'row' }, state.chat.length ? h('button', { class: 'ghost', onclick: () => { state.chat = []; state.selected = null; renderMsgs(); renderSide(); } }, 'Effacer la conversation') : null, sendBtn)))))),
    side));
  renderMsgs(); renderSide(); ta.focus();
}

async function showChunk(id) {
  const c = await api('chunk', id);
  if (!c) return;
  await modal(c.title + ' › ' + c.headingPath, h('div', null, h('div', { class: 'md', style: 'max-height:50vh;overflow:auto;white-space:pre-wrap' }, c.text), h('p', { class: 'small muted' }, c.path)), [
    { label: 'Ouvrir dans Obsidian', value: 'o' }, { label: 'Fermer', value: 'x', primary: true }]).then((v) => { if (v === 'o') window.app.openExternal(c.uri); });
}

// ───────────────────────── Graphe
async function pageGraph(root) {
  root.className = 'page full';
  let gv = null;
  const f = { type: '', community: '', tag: '', q: '', limit: 600 };
  const sel = (id, label, opts, cur, on) => h('select', { 'aria-label': label, onchange: (e) => on(e.target.value) }, h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(cur) }, l)));
  const toolbar = h('div', { class: 'gtools' });
  const canvas = h('canvas');
  const legend = h('div', { class: 'legend', 'aria-hidden': 'true' });
  const side = h('aside', { class: 'gside', 'aria-label': 'Détails' });
  const wrap = h('div', { class: 'gcanvas' }, canvas, legend);
  root.append(toolbar, h('div', { class: 'gwrap' }, wrap, side));
  gv = new GraphView(canvas, { onSelect: (n) => showNode(n ? n.id : null) });
  let meta = null;

  async function load() {
    const d = await api('graph', { type: f.type || undefined, community: f.community || undefined, tag: f.tag || undefined, q: f.q || undefined, limit: Number(f.limit) });
    meta = d;
    buildToolbar(d);
    gv.setData(d.nodes, d.edges);
    drawLegend();
    if (!d.nodes.length) side.replaceChildren(h('div', { class: 'empty' }, state.status.documents ? 'Aucun nœud pour ces filtres.' : 'Le graphe est vide : lancez d’abord une ingestion.'));
    else if (!gv.selected) showNode(null);
  }

  function drawLegend() { legend.replaceChildren(...gv.legend().map((l) => h('span', { class: 'row', style: 'gap:5px' }, h('i', { class: 'dot', style: 'background:' + l.color }), l.label))); }

  function buildToolbar(d) {
    const search = h('input', { type: 'text', placeholder: 'Chercher un nœud…', 'aria-label': 'Chercher un nœud', value: f.q, style: 'width:180px' });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { f.q = search.value.trim(); load(); } });
    const pa = h('input', { type: 'text', placeholder: 'Chemin : de…', 'aria-label': 'Départ du chemin', style: 'width:120px' });
    const pb = h('input', { type: 'text', placeholder: 'à…', 'aria-label': 'Arrivée du chemin', style: 'width:120px' });
    toolbar.replaceChildren(search,
      sel('t', 'Tous les types', d.types.map((t) => [t, t]), f.type, (v) => { f.type = v; load(); }),
      sel('c', 'Toutes les communautés', d.communities.map((c) => [c.id, c.title]), f.community, (v) => { f.community = v; load(); }),
      sel('g', 'Tous les tags', d.tags.map((t) => [t.tag, '#' + t.tag + ' (' + t.n + ')']), f.tag, (v) => { f.tag = v; load(); }),
      h('select', { 'aria-label': 'Nombre de nœuds', onchange: (e) => { f.limit = e.target.value; load(); } }, [200, 600, 1500, 3000].map((n) => h('option', { value: n, selected: Number(f.limit) === n }, n + ' nœuds max'))),
      h('select', { 'aria-label': 'Couleur', onchange: (e) => { gv.colorBy = e.target.value; drawLegend(); gv._draw(); } }, h('option', { value: 'community' }, 'Couleur : communauté'), h('option', { value: 'type', selected: gv.colorBy === 'type' }, 'Couleur : type')),
      h('span', { class: 'grow' }), pa, pb,
      h('button', { onclick: async () => { if (!pa.value || !pb.value) return toast('Renseignez deux entités'); const p = await guard(() => api('path', pa.value, pb.value)); if (!p) return; if (!p.found) return toast(p.missing && p.missing.length ? 'Introuvable : ' + p.missing.join(', ') : 'Aucun chemin entre ces deux entités'); const ids = p.nodes.map((n) => n.id); gv.highlightPath(ids); if (ids.some((i) => !gv.nodes.find((n) => n.id === i))) toast('Une partie du chemin est hors des filtres actuels'); side.replaceChildren(h('h2', null, 'Chemin'), h('div', { class: 'pathline' }, p.nodes.flatMap((n, i) => [i ? h('span', { class: 'muted' }, '→') : null, h('button', { class: 'chip accent', onclick: () => go('explore', { tab: 'entities', entity: n.id }) }, n.name)])), p.edges.map((e) => h('div', { class: 'src' }, h('b', null, e.subject), ' ', h('span', { class: 'muted' }, e.predicate.replace(/_/g, ' ')), ' ', h('b', null, e.object), e.quote ? h('div', { class: 'quote' }, '« ' + e.quote + ' »') : null))); } }, 'Chemin'),
      h('button', { class: 'ghost', title: 'Recentrer', onclick: () => gv.fit() }, 'Recentrer'),
      h('button', { class: 'ghost', onclick: async () => { const u = gv.toDataURL(); const p = await window.app.saveFile('graphe.png', u.split(',')[1], true); if (p) toast('Image enregistrée', 'ok'); } }, 'Image PNG'));
    if (meta) toolbar.append(h('span', { class: 'small muted' }, `${meta.nodes.length}/${meta.total}`));
  }

  async function showNode(id) {
    gv.selected = id; gv._draw();
    if (id == null) {
      side.replaceChildren(h('h2', null, 'Graphe'), h('p', { class: 'muted' }, 'Cliquez sur un nœud pour voir ses relations. Molette : zoom, glisser : déplacer. Contour = note Obsidian.'),
        h('h3', null, 'Plus connectés'), ...gv.nodes.slice(0, 10).map((n) => h('button', { class: 'chip', style: 'margin:0 4px 4px 0', onclick: () => { gv.select(n.id, true); showNode(n.id); } }, h('i', { class: 'dot', style: 'background:' + gv.colorOf(n) }), n.name)));
      return;
    }
    const e = await guard(() => api('entity', id)); if (!e) return;
    side.replaceChildren(h('h2', null, e.name), h('div', { class: 'row' }, h('span', { class: 'chip' }, h('i', { class: 'dot', style: 'background:' + typeColor(e.type) }), e.type), e.community ? h('span', { class: 'chip', title: e.community.summary }, e.community.title) : null),
      e.description ? h('p', { class: 'small' }, e.description) : null,
      h('h3', null, 'Relations (' + e.relations.length + ')'),
      e.relations.slice(0, 12).map((r) => h('div', { style: 'margin-bottom:8px' }, h('button', { class: 'ghost sm', onclick: () => { const o = r.subjectId === e.id ? r.objectId : r.subjectId; gv.select(o, true); showNode(o); } }, (r.subjectId === e.id ? '→ ' : '← ') + (r.subjectId === e.id ? r.object : r.subject)), h('span', { class: 'small muted' }, ' ' + r.predicate.replace(/_/g, ' ')), r.quote ? h('div', { class: 'quote' }, '« ' + r.quote.slice(0, 140) + ' »') : null)),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: () => go('explore', { tab: 'entities', entity: id }) }, 'Fiche complète')));
  }

  const opts = state.params;
  if (opts.focus) f.q = '';
  await load();
  if (opts.focus) { gv.select(opts.focus, true); showNode(opts.focus); }
}

// ───────────────────────── Explorer
async function pageExplore(root, params) {
  root.className = 'page';
  const tab = params.tab || 'entities';
  const list = h('div', { class: 'list', role: 'list', 'aria-label': 'Résultats' });
  const detail = h('div', { class: 'detail' });
  const search = h('input', { type: 'text', placeholder: tab === 'entities' ? 'Chercher une entité…' : tab === 'notes' ? 'Chercher une note, un tag…' : 'Filtrer…', 'aria-label': 'Recherche', style: 'width:100%' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['entities', 'Entités'], ['notes', 'Notes'], ['communities', 'Thèmes']].map(([id, l]) => h('button', { role: 'tab', 'aria-selected': tab === id ? 'true' : 'false', onclick: () => go('explore', { tab: id }) }, l)));
  root.append(h('div', { class: 'pagehead' }, h('div', null, h('h1', null, 'Explorateur'), h('p', { class: 'sub' }, 'Parcourez les entités, les notes et les thèmes détectés. Corrigez ce qui est mal extrait : vos corrections sont conservées.'))), tabs,
    h('div', { class: 'split' }, h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-height:0' }, search, list), detail));
  let current = null;

  function item(key, titleEl, sub, open) {
    const b = h('button', { class: 'li', role: 'listitem', 'data-key': key, 'aria-current': String(String(current) === String(key)), onclick: () => { current = key; [...list.children].forEach((c) => c.setAttribute('aria-current', String(c === b))); open(); } }, titleEl, sub ? h('div', { class: 'small muted' }, sub) : null);
    return b;
  }

  async function loadList() {
    list.replaceChildren();
    if (tab === 'entities') {
      const r = await api('searchEntities', search.value, 150);
      r.forEach((e) => list.append(item(e.id, h('span', { class: 'row', style: 'gap:7px' }, h('i', { class: 'dot', style: 'background:' + typeColor(e.type) }), e.name), e.type, () => showEntity(e.id))));
      if (!r.length) list.append(h('div', { class: 'empty' }, 'Aucune entité'));
    } else if (tab === 'notes') {
      const r = await api('noteList', search.value);
      r.forEach((n) => list.append(item(n.path, n.title, `${n.path} · ${n.inbound} ← · → ${n.outbound}`, () => showNote(n.path))));
      if (!r.length) list.append(h('div', { class: 'empty' }, 'Aucune note'));
    } else {
      const all = await api('communities'); const k = search.value.toLowerCase();
      all.filter((c) => !k || (c.title + c.summary).toLowerCase().includes(k)).forEach((c) => list.append(item(c.id, c.title, c.size + ' éléments', () => showCommunity(c))));
      if (!all.length) list.append(h('div', { class: 'empty' }, 'Aucun thème : lancez une ingestion.'));
    }
  }

  async function showEntity(id) {
    const e = await guard(() => api('entity', id)); if (!e) return;
    const refresh = () => showEntity(e.id);
    detail.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'row' }, h('h1', { class: 'grow' }, e.name), e.locked ? h('span', { class: 'chip ok', title: 'Modifiée manuellement : jamais écrasée' }, '🔒 verrouillée') : null, h('span', { class: 'chip' }, h('i', { class: 'dot', style: 'background:' + typeColor(e.type) }), e.type)),
        e.aliases.length ? h('div', { class: 'small muted' }, 'Alias : ' + e.aliases.join(', ')) : null,
        e.description ? h('p', null, e.description) : null,
        e.community ? h('p', { class: 'small' }, h('b', null, 'Thème : '), h('button', { class: 'chip accent', onclick: () => go('explore', { tab: 'communities' }) }, e.community.title)) : null,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { onclick: () => go('graph', { focus: e.id }) }, 'Voir dans le graphe'),
          h('button', { onclick: async () => { const n = await promptDlg('Renommer', 'Nouveau nom', e.name); if (n && n !== e.name && (await guard(() => api('correct', 'rename', { id: e.id, name: n })))) { toast('Renommée', 'ok'); loadList(); refresh(); } } }, 'Renommer'),
          h('button', { onclick: () => mergeDialog(e, () => { loadList(); detail.replaceChildren(); }) }, 'Fusionner dans…'),
          h('button', { onclick: () => relationDialog(e, refresh) }, 'Ajouter une relation'),
          h('button', { class: 'danger', onclick: async () => { if (await confirmDlg('Supprimer cette entité ?', `« ${e.name} » sera retirée du graphe et ne sera plus recréée lors des prochaines ingestions.`, 'Supprimer', true) && (await guard(() => api('correct', 'delete', { id: e.id })))) { toast('Supprimée', 'ok'); loadList(); detail.replaceChildren(); } } }, 'Supprimer'))),
      h('div', { class: 'card' }, h('h2', null, 'Relations (' + e.relations.length + ')'),
        e.relations.length ? h('table', null, h('thead', null, h('tr', null, ['Relation', 'Phrase source', ''].map((x) => h('th', null, x)))),
          h('tbody', null, e.relations.map((r) => h('tr', null,
            h('td', null, h('button', { class: 'ghost sm', onclick: () => showEntity(r.subjectId === e.id ? r.objectId : r.subjectId) }, r.subjectId === e.id ? '' : r.subject + ' ', h('span', { class: 'muted' }, '—' + r.predicate.replace(/_/g, ' ') + '→'), ' ' + (r.objectId === e.id ? '' : r.object)), h('div', { class: 'small muted' }, { wiki: 'lien [[wiki]]', mention: 'mention', llm: 'extraction IA', manual: 'manuelle' }[r.origin] || r.origin)),
            h('td', null, r.quote ? h('span', { class: 'quote' }, '« ' + r.quote.slice(0, 220) + ' »') : '—'),
            h('td', null, h('div', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' }, r.chunkId ? h('button', { class: 'sm', onclick: () => showChunk(r.chunkId) }, 'Source') : null, h('button', { class: 'sm danger', title: 'Supprimer cette relation', 'aria-label': 'Supprimer cette relation', onclick: async () => { if (await guard(() => api('correct', 'delete_relation', { id: r.id }))) refresh(); } }, '✕'))))))) : h('div', { class: 'muted' }, 'Aucune relation')),
      h('div', { class: 'card' }, h('h2', null, 'Notes où elle apparaît'), e.notes.length ? e.notes.map((n) => h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => go('explore', { tab: 'notes', note: n.path }) }, n.title), h('span', { class: 'small muted grow' }, n.path), h('button', { class: 'sm', onclick: () => window.app.openExternal(n.uri) }, 'Obsidian'))) : h('div', { class: 'muted' }, 'Aucune')),
      e.corrections.length ? h('div', { class: 'card' }, h('h2', null, 'Historique des corrections'), e.corrections.map((c) => h('div', { class: 'small' }, fmtDate(c.date) + ' — ' + c.action + ' ' + c.target))) : null);
  }

  async function mergeDialog(e, done) {
    const q = h('input', { type: 'text', placeholder: 'Rechercher l’entité à conserver…', style: 'width:100%' });
    const res = h('div', { style: 'max-height:220px;overflow:auto;margin-top:8px' });
    let chosen = null;
    const upd = async () => { const r = (await api('searchEntities', q.value, 12)).filter((x) => x.id !== e.id); res.replaceChildren(...r.map((x) => h('button', { class: 'li', style: 'padding:6px 8px;border-radius:6px', onclick: (ev) => { chosen = x; [...res.children].forEach((c) => c.style.background = ''); ev.currentTarget.style.background = 'var(--accent-2)'; } }, x.name + ' · ' + x.type))); };
    q.addEventListener('input', upd); upd();
    const ok = await modal(`Fusionner « ${e.name} »`, h('div', null, h('p', { class: 'small muted' }, 'Toutes les relations et mentions seront transférées vers l’entité choisie ; le nom actuel devient un alias.'), q, res), [{ label: 'Annuler', value: false }, { label: 'Fusionner', value: true, primary: true }]);
    if (ok && chosen) { if (await guard(() => api('correct', 'merge', { into: chosen.id, from: e.id }))) { toast('Fusionnée dans ' + chosen.name, 'ok'); done(); } }
  }

  async function relationDialog(e, done) {
    const q = h('input', { type: 'text', placeholder: 'Rechercher l’entité liée…', style: 'width:100%' });
    const res = h('div', { style: 'max-height:160px;overflow:auto;margin:8px 0' });
    const pred = h('input', { type: 'text', value: 'lié_à', style: 'width:100%' });
    const quote = h('input', { type: 'text', placeholder: 'Justification (optionnelle)', style: 'width:100%' });
    let chosen = null;
    const upd = async () => { const r = (await api('searchEntities', q.value, 10)).filter((x) => x.id !== e.id); res.replaceChildren(...r.map((x) => h('button', { class: 'li', style: 'padding:6px 8px;border-radius:6px', onclick: (ev) => { chosen = x; [...res.children].forEach((c) => c.style.background = ''); ev.currentTarget.style.background = 'var(--accent-2)'; } }, x.name))); };
    q.addEventListener('input', upd); upd();
    const ok = await modal(`Nouvelle relation depuis « ${e.name} »`, h('div', null, q, res, h('label', { class: 'field' }, h('span', null, 'Type de relation'), pred), h('label', { class: 'field' }, h('span', null, 'Justification'), quote)), [{ label: 'Annuler', value: false }, { label: 'Ajouter', value: true, primary: true }]);
    if (ok && chosen && (await guard(() => api('correct', 'add_relation', { subj: e.id, obj: chosen.id, pred: pred.value.trim() || 'lié_à', quote: quote.value })))) { toast('Relation ajoutée', 'ok'); done(); }
  }

  async function showNote(ref) {
    const n = await guard(() => api('note', ref)); if (!n) { detail.replaceChildren(h('div', { class: 'empty' }, 'Note introuvable')); return; }
    const body = h('div', { class: 'md' }, md(n.summary || '*Note vide*', {}));
    highlightEntities(body, n.entities, (en) => go('explore', { tab: 'entities', entity: en.id }));
    detail.replaceChildren(
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('h1', { class: 'grow' }, n.title), h('button', { onclick: () => window.app.openExternal(n.uri) }, 'Ouvrir dans Obsidian')),
        h('div', { class: 'small muted' }, n.path), h('div', { class: 'row', style: 'margin-top:6px;gap:5px' }, n.tags.map((t) => h('span', { class: 'chip' }, '#' + t)), n.aliases.map((a) => h('span', { class: 'chip accent' }, 'alias : ' + a)))),
      h('div', { class: 'card' }, body),
      h('div', { class: 'card' }, h('h2', null, 'Entités détectées (' + n.entities.length + ')'), h('div', { class: 'row', style: 'gap:5px' }, n.entities.map((e) => h('button', { class: 'chip', onclick: () => go('explore', { tab: 'entities', entity: e.id }) }, h('i', { class: 'dot', style: 'background:' + typeColor(e.type) }), e.name)))),
      h('div', { class: 'card' }, h('div', { class: 'row', style: 'align-items:flex-start' },
        h('div', { class: 'grow' }, h('h2', null, 'Liens sortants (' + n.links.length + ')'), n.links.length ? n.links.map((l) => h('div', null, l.target_path ? h('button', { class: 'ghost sm', onclick: () => showNote(l.target_path) }, l.target_title + (l.section ? ' › ' + l.section : '')) : h('span', { class: 'chip bad', title: 'Lien cassé : la cible n’existe pas' }, '⚠ ' + l.target_raw), l.type === 'embed' ? h('span', { class: 'small muted' }, ' (embed)') : null)) : h('span', { class: 'muted' }, 'Aucun')),
        h('div', { class: 'grow' }, h('h2', null, 'Liens entrants (' + n.backlinks.length + ')'), n.backlinks.length ? n.backlinks.map((b) => h('div', null, h('button', { class: 'ghost sm', onclick: () => showNote(b.path) }, b.title))) : h('span', { class: 'muted' }, 'Aucun')))));
  }

  function showCommunity(c) {
    detail.replaceChildren(h('div', { class: 'card' }, h('h1', null, c.title), h('p', null, c.summary), h('p', { class: 'small muted' }, c.size + ' éléments'),
      h('div', { class: 'row', style: 'gap:5px' }, c.members.map((m) => h('button', { class: 'chip', onclick: () => go('explore', { tab: 'entities', entity: m.id }) }, h('i', { class: 'dot', style: 'background:' + typeColor(m.type) }), m.name))),
      c.subs.length ? h('div', null, h('h3', null, 'Sous-thèmes'), c.subs.map((s) => h('div', null, s.title + ' (' + s.size + ')'))) : null,
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { onclick: () => go('graph', {}) }, 'Voir le graphe'))));
  }

  let t = 0; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadList, 180); });
  await loadList();
  if (params.entity != null) showEntity(params.entity);
  else if (params.note) showNote(params.note);
  else detail.append(h('div', { class: 'empty' }, 'Sélectionnez un élément dans la liste.'));
}

// ───────────────────────── Revue
async function pageReview(root) {
  const items = await api('reviews');
  const groups = { merge_candidate: ['Fusions possibles', 'Deux entités au nom très proche : sont-ce les mêmes ?'], extraction_failed: ['Extractions échouées', 'Ces passages n’ont pas pu être analysés.'], broken_link: ['Liens cassés', 'Le lien [[…]] ne pointe vers aucune note.'], empty_note: ['Notes vides', 'Aucun contenu exploitable.'] };
  root.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', null, 'Revue'), h('p', { class: 'sub' }, items.length ? items.length + ' élément(s) à vérifier. Vos décisions sont conservées.' : 'Rien à vérifier.')),
    h('button', { onclick: async () => { const l = await api('exportCorrections'); const p = await window.app.saveFile('corrections.json', JSON.stringify(l, null, 2)); if (p) toast('Corrections exportées', 'ok'); } }, 'Exporter mes corrections'),
    h('button', { onclick: async () => { const t = await window.app.openFile([{ name: 'JSON', extensions: ['json'] }]); if (!t) return; const r = await guard(() => api('importCorrections', JSON.parse(t))); if (r) toast(r.imported + ' corrections importées. Relancez une ingestion complète pour les appliquer.', 'ok'); } }, 'Importer')));
  if (!items.length) root.append(h('div', { class: 'card empty' }, '✓ Tout est en ordre.'));
  for (const [kind, [title, desc]] of Object.entries(groups)) {
    const list = items.filter((i) => i.kind === kind); if (!list.length) continue;
    const card = h('div', { class: 'card' }, h('h2', null, `${title} (${list.length})`), h('p', { class: 'small muted' }, desc));
    list.slice(0, 100).forEach((it) => {
      const p = it.payload; const row = h('div', { class: 'row', style: 'padding:6px 0;border-top:1px solid var(--line)' });
      const act = async (d) => { if (await guard(() => api('resolveReview', it.id, d))) { row.remove(); refreshStatus(); } };
      if (kind === 'merge_candidate') row.append(h('div', { class: 'grow' }, h('b', null, p.aName || '?'), ' ≈ ', h('b', null, p.bName), h('span', { class: 'small muted' }, ' (similarité ' + Math.round((p.score || 0) * 100) + ' %)')), h('button', { class: 'sm primary', disabled: !p.bId, onclick: () => act('accept') }, 'Fusionner'), h('button', { class: 'sm', onclick: () => act('reject') }, 'Garder séparées'));
      else if (kind === 'extraction_failed') row.append(h('div', { class: 'grow' }, h('b', null, p.doc), h('div', { class: 'small muted' }, p.error)), h('button', { class: 'sm', onclick: () => act('retry') }, 'Réessayer'), h('button', { class: 'sm', onclick: () => act('reject') }, 'Ignorer'));
      else if (kind === 'broken_link') row.append(h('div', { class: 'grow' }, h('span', { class: 'mono' }, p.from), ' → ', h('b', null, '[[' + p.target + ']]')), h('button', { class: 'sm', onclick: () => go('explore', { tab: 'notes', note: p.from }) }, 'Ouvrir la note'), h('button', { class: 'sm', onclick: () => act('reject') }, 'Ignorer'));
      else row.append(h('div', { class: 'grow mono' }, p.path), h('button', { class: 'sm', onclick: () => act('reject') }, 'Ignorer'));
      card.append(row);
    });
    root.append(card);
  }
}

// ───────────────────────── Ingestion
async function pageIngest(root, params) {
  const s = state.status;
  const prog = h('div', { class: 'card', style: 'display:none' });
  const out = h('div');
  const btnRun = h('button', { class: 'primary' }, 'Lancer l’ingestion');
  const btnEst = h('button', null, 'Estimer le coût');
  const btnFull = h('button', { class: 'ghost', title: 'Retraite tous les fichiers (le cache évite les appels LLM identiques)' }, 'Ingestion complète');
  const btnCancel = h('button', { class: 'danger' }, 'Annuler');
  let running = !!(s.progress && s.progress.running);

  function drawProgress(p) {
    if (!p || !p.running) { prog.style.display = 'none'; return; }
    prog.style.display = '';
    const pct = p.total ? Math.round((p.done / p.total) * 100) : null;
    prog.replaceChildren(h('div', { class: 'row' }, h('b', { class: 'grow' }, '⟳ ' + (p.step || 'Démarrage')), btnCancel), h('div', { class: 'bar', style: 'margin:8px 0' }, h('i', { style: 'width:' + (pct == null ? 100 : pct) + '%;' + (pct == null ? 'opacity:.35' : '') })), h('div', { class: 'small muted' }, (p.total ? `${p.done}/${p.total} — ` : '') + (p.msg || '')));
  }
  const off = window.app.on(async (t, p) => {
    if (t === 'progress') {
      drawProgress(p); running = !!p.running; btnRun.disabled = btnEst.disabled = btnFull.disabled = running;
      if (state.status) { state.status.progress = p; renderNav(); }
      if (!p.running) { await refreshStatus(); if (state.page === 'ingest') go('ingest'); }
    }
  });
  cleanup = off;

  function estimateCard(e) {
    return h('div', { class: 'card' }, h('h2', null, 'Estimation'),
      h('div', { class: 'kpis' }, [['Ajouts', e.added], ['Modifiées', e.modified], ['Supprimées', e.deleted], ['Inchangées', e.unchanged], ['Passages à analyser', e.chunks]].map(([l, v]) => h('div', { class: 'kpi' }, h('b', null, fmtNum(v)), h('span', null, l)))),
      e.llmAvailable ? h('p', null, `Extraction avec ${e.model} : environ ${fmtNum(e.tokensIn)} tokens en entrée et ${fmtNum(e.tokensOut)} en sortie → `, h('b', null, 'coût estimé ' + money(e.cost)), '. Les passages déjà en cache ne sont pas facturés.') :
        h('p', null, 'Aucune clé API configurée : le graphe sera construit sans IA (liens, tags, mentions) pour 0 $. Ajoutez une clé dans Réglages pour extraire entités et relations.'));
  }

  async function start(full) {
    const e = await guard(() => api('estimate', { full }));
    if (!e) return;
    out.replaceChildren(estimateCard(e));
    if (!e.added && !e.modified && !e.deleted && !full && !state.status.pendingExtraction) return toast('Tout est déjà à jour', 'ok');
    if (e.llmAvailable && e.cost > 0.25 && !(await confirmDlg('Confirmer le lancement ?', `Coût estimé : ${money(e.cost)} (${fmtNum(e.chunks)} passages, ${e.model}). Budget maximum par ingestion : ${money(state.settings ? state.settings.llm.budgetPerJob : 5)}.`, 'Lancer'))) return;
    running = true; btnRun.disabled = btnEst.disabled = btnFull.disabled = true;
    drawProgress({ running: true, step: 'Démarrage' });
    const r = await guard(() => api('ingest', { full }), 'Ingestion');
    running = false;
    if (r) toast(r.cancelled ? 'Ingestion annulée' : `Terminé : ${r.added} ajoutées, ${r.modified} modifiées, ${r.deleted} supprimées` + (r.errors.length ? ` (${r.errors.length} avertissement(s))` : ''), r.errors.length ? '' : 'ok');
    go('ingest');
  }
  btnRun.onclick = () => start(false); btnFull.onclick = () => start(true); btnEst.onclick = async () => { const e = await guard(() => api('estimate', {})); if (e) out.replaceChildren(estimateCard(e)); };
  btnCancel.onclick = () => api('cancelIngest');
  btnRun.disabled = btnEst.disabled = btnFull.disabled = running;

  const [costs, jobs] = await Promise.all([api('costs'), api('jobs')]);
  state.settings = await api('getSettings');
  const last = s.lastJob && s.lastJob.stats;

  root.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', null, 'Ingestion'), h('p', { class: 'sub' }, 'Lit vos coffres, construit le graphe et les index. Incrémental : seules les notes modifiées sont retraitées.')),
    btnEst, btnFull, btnRun), prog, out);

  root.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Sources'), h('button', { onclick: async () => { if (await guard(addVault)) go('ingest'); } }, 'Ajouter un coffre…')),
    s.vaults.length ? h('table', null, h('thead', null, h('tr', null, ['Coffre', 'Chemin', 'Notes', ''].map((x) => h('th', null, x)))), h('tbody', null, s.vaults.map((v) => h('tr', null, h('td', null, h('b', null, v.name)), h('td', { class: 'mono' }, v.path), h('td', null, fmtNum(v.documents)), h('td', null, v.exists ? '' : h('span', { class: 'chip bad' }, 'introuvable')))))) : h('div', { class: 'empty' }, 'Aucun coffre configuré.')));

  root.append(h('div', { class: 'kpis', style: 'margin-top:14px' }, [['Notes', s.documents], ['Passages', s.chunks], ['Entités', s.entities], ['Relations', s.relations], ['Thèmes', s.communities], ['En attente d’IA', s.pendingExtraction]].map(([l, v]) => h('div', { class: 'kpi' }, h('b', null, fmtNum(v)), h('span', null, l)))));

  if (last && s.lastJob.status !== 'running') {
    root.append(h('div', { class: 'card' }, h('h2', null, 'Dernier rapport — ' + fmtDate(s.lastJob.ended)),
      h('p', null, `${last.added} ajoutées · ${last.modified} modifiées · ${last.deleted} supprimées · ${last.brokenLinks || 0} liens cassés · ${last.llmCalls || 0} appels IA (${last.cacheHits || 0} en cache) · coût ${money(last.cost || 0)}`),
      s.lastJob.errors.length ? h('details', null, h('summary', null, s.lastJob.errors.length + ' avertissement(s)'), h('ul', { class: 'small' }, s.lastJob.errors.slice(0, 50).map((e) => h('li', null, e)))) : h('span', { class: 'chip ok' }, '✓ sans erreur')));
  }

  root.append(h('div', { class: 'card' }, h('h2', null, 'Coûts'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'small muted' }, `Ce mois : ${money(costs.month)} / ${money(costs.budgetMonth)}`), h('div', { class: 'bar', style: 'margin-top:6px' }, h('i', { style: 'width:' + Math.min(100, (costs.month / costs.budgetMonth) * 100) + '%' })))),
    costs.byStep.length ? h('table', { style: 'margin-top:10px' }, h('thead', null, h('tr', null, ['Étape', 'Appels', 'Coût'].map((x) => h('th', null, x)))), h('tbody', null, costs.byStep.map((r) => h('tr', null, h('td', null, r.step || '—'), h('td', null, r.calls), h('td', null, money(r.cost)))))) : h('p', { class: 'muted' }, 'Aucune dépense.'),
    costs.byDay.length ? h('details', { style: 'margin-top:8px' }, h('summary', null, 'Par jour'), h('table', null, costs.byDay.slice(0, 14).map((d) => h('tr', null, h('td', null, d.day), h('td', null, fmtNum(d.tin + d.tout) + ' tokens'), h('td', null, money(d.cost)))))) : null));

  root.append(h('div', { class: 'card' }, h('h2', null, 'Maintenance et export'), h('div', { class: 'row' },
    ['graphml', 'json', 'csv', 'md'].map((f) => h('button', { onclick: async () => { const t = await guard(() => api('exportGraph', f)); if (t) { const p = await window.app.saveFile('graphe.' + f, t); if (p) toast('Exporté : ' + p, 'ok'); } } }, 'Exporter ' + f.toUpperCase())),
    h('button', { onclick: async () => { const t = await window.app.openFile([{ name: 'Questions (JSON)', extensions: ['json'] }]); if (!t) return; toast('Évaluation en cours…'); const r = await guard(() => api('evaluate', JSON.parse(t)), 'Évaluation'); if (r) { await modal('Résultat de l’évaluation', h('pre', { class: 'mono', style: 'white-space:pre-wrap;max-height:50vh;overflow:auto' }, r.markdown), [{ label: 'Fermer', value: 1, primary: true }]); } } }, 'Lancer une évaluation…'),
    h('button', { class: 'danger', onclick: async () => { if (await confirmDlg('Reconstruire toute la base ?', 'Les index dérivés sont recréés depuis vos notes. Vos corrections sont conservées ; le cache évite de refacturer les analyses identiques.', 'Reconstruire', true)) { running = true; go('ingest'); guard(() => api('rebuild')).then(() => go('ingest')); } } }, 'Reconstruire'))));

  root.append(h('div', { class: 'card' }, h('h2', null, 'Historique'), jobs.length ? h('table', null, h('thead', null, h('tr', null, ['Date', 'Statut', 'Résultat'].map((x) => h('th', null, x)))), h('tbody', null, jobs.slice(0, 10).map((j) => h('tr', null, h('td', null, fmtDate(j.started)), h('td', null, h('span', { class: 'chip ' + (j.status === 'terminé' ? 'ok' : j.status === 'erreur' ? 'bad' : '') }, j.status)), h('td', { class: 'small muted' }, j.stats && j.stats.added != null ? `+${j.stats.added} ~${j.stats.modified} −${j.stats.deleted} · ${money(j.stats.cost || 0)}` : ''))))) : h('p', { class: 'muted' }, 'Aucune ingestion.')));

  if (params.auto && !running && s.vaults.length) btnEst.click();
}

// ───────────────────────── Réglages
async function pageSettings(root) {
  const cfg = await api('getSettings'); const info = await window.app.info();
  const inp = (label, val, attrs = {}) => { const i = h('input', { type: 'text', value: val, ...attrs }); return [h('label', { class: 'field' }, h('span', null, label), i), i]; };
  const [fKey, iKey] = inp('Clé API Anthropic', '', { type: 'password', placeholder: cfg.llm.hasKey ? '•••••••• (enregistrée, chiffrée)' : 'sk-ant-…', autocomplete: 'off' });
  const models = {}; const mrows = [['extract', 'Extraction (volume)'], ['summary', 'Résumés de thèmes'], ['answer', 'Réponses'], ['global', 'Synthèses globales'], ['judge', 'Évaluation (juge)']].map(([k, l]) => { const [f, i] = inp(l, cfg.llm.models[k]); models[k] = i; return f; });
  const num = (label, v, step = 1) => { const [f, i] = inp(label, v, { type: 'number', step }); return [f, i]; };
  const [fBJ, iBJ] = num('Budget maximum par ingestion ($)', cfg.llm.budgetPerJob, 0.5), [fBM, iBM] = num('Budget mensuel ($)', cfg.llm.budgetPerMonth, 1), [fCo, iCo] = num('Appels simultanés', cfg.llm.concurrency);
  const [fTop, iTop] = num('Passages utilisés par réponse', cfg.retrieval.topChunks), [fDep, iDep] = num('Profondeur du voisinage', cfg.retrieval.depth), [fRes, iRes] = num('Résolution des communautés', cfg.communities.resolution, 0.1);
  const [fMer, iMer] = num('Seuil de fusion automatique (0–1)', cfg.extraction.mergeThreshold, 0.01), [fRev, iRev] = num('Seuil de revue (0–1)', cfg.extraction.reviewThreshold, 0.01), [fCon, iCon] = num('Confiance minimale des relations', cfg.extraction.minConfidence, 0.05);
  const theme = h('select', null, [['auto', 'Automatique (système)'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => h('option', { value: v, selected: cfg.ui.theme === v }, l)));
  const wOn = h('input', { type: 'checkbox', checked: cfg.auto.watch }), tOn = h('input', { type: 'checkbox', checked: cfg.auto.tray }), sOn = h('input', { type: 'checkbox', checked: cfg.auto.startWithWindows });
  const [fEv, iEv] = num('Ingestion planifiée toutes les N minutes (0 = désactivée)', cfg.auto.everyMinutes);
  const ocrOn = h('input', { type: 'checkbox', checked: cfg.ocr.enabled }), ocrImg = h('input', { type: 'checkbox', checked: cfg.ocr.images });
  const ocrLang = h('select', null, [['fra+eng', 'Français + anglais'], ['fra', 'Français'], ['eng', 'Anglais']].map(([v, l]) => h('option', { value: v, selected: cfg.ocr.languages === v }, l)));
  const httpOn = h('input', { type: 'checkbox', checked: cfg.server.http }); const [fPort, iPort] = num('Port', cfg.server.port);
  const vaultRows = cfg.vaults.map((v, idx) => {
    const ex = h('input', { type: 'text', value: (v.exclude || []).join(', '), placeholder: 'Dossiers à exclure (séparés par des virgules)', style: 'width:100%' });
    const gn = h('input', { type: 'checkbox', checked: v.writeGraphNotes !== false });
    return { v, ex, gn, el: h('div', { class: 'card', style: 'box-shadow:none' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, v.name), h('button', { class: 'danger sm', onclick: async () => { if (await confirmDlg('Retirer ce coffre ?', 'Le coffre sera retiré de la configuration (vos fichiers ne sont pas touchés). Ses notes disparaîtront du graphe à la prochaine ingestion.', 'Retirer', true)) { await api('setSettings', { vaults: cfg.vaults.filter((_, i) => i !== idx) }); go('settings'); } } }, 'Retirer')), h('div', { class: 'mono muted' }, v.path), h('label', { class: 'field' }, h('span', null, 'Exclusions'), ex), h('label', { class: 'row' }, gn, 'Écrire des pages de synthèse dans le dossier « _graph » du coffre (les notes existantes ne sont jamais modifiées)')) };
  });
  const mcpCmd = JSON.stringify({ mcpServers: { graphrag: { command: info.exe, args: [info.mcpScript], env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2);

  async function save() {
    const patch = {
      llm: { models: Object.fromEntries(Object.entries(models).map(([k, i]) => [k, i.value.trim()])), budgetPerJob: Number(iBJ.value), budgetPerMonth: Number(iBM.value), concurrency: Math.max(1, Number(iCo.value)) },
      retrieval: { topChunks: Number(iTop.value), depth: Number(iDep.value) }, communities: { resolution: Number(iRes.value) },
      extraction: { mergeThreshold: Number(iMer.value), reviewThreshold: Number(iRev.value), minConfidence: Number(iCon.value) },
      server: { http: httpOn.checked, port: Number(iPort.value) }, ocr: { enabled: ocrOn.checked, images: ocrImg.checked, languages: ocrLang.value }, auto: { watch: wOn.checked, tray: tOn.checked, startWithWindows: sOn.checked, everyMinutes: Math.max(0, Number(iEv.value)) }, ui: { theme: theme.value },
      vaults: vaultRows.map((r) => ({ ...r.v, exclude: r.ex.value.split(',').map((x) => x.trim()).filter(Boolean), writeGraphNotes: r.gn.checked })),
    };
    if (iKey.value.trim()) patch.llm.apiKey = iKey.value.trim();
    if (await guard(() => api('setSettings', patch), 'Enregistrement')) { applyTheme(theme.value); toast('Réglages enregistrés', 'ok'); go('settings'); }
  }

  root.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', null, 'Réglages'), h('p', { class: 'sub' }, 'Version ' + info.version + ' · données : ' + info.dataDir)), h('button', { class: 'primary', onclick: save }, 'Enregistrer')));
  root.append(
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Coffres'), h('button', { onclick: async () => { if (await guard(addVault)) go('settings'); } }, 'Ajouter un coffre…')), vaultRows.length ? vaultRows.map((r) => r.el) : h('p', { class: 'muted' }, 'Aucun coffre.')),
    h('div', { class: 'card' }, h('h2', null, 'Modèles Claude'), cfg.llm.keyFromEnv ? h('p', { class: 'chip ok' }, 'Clé lue depuis la variable ANTHROPIC_API_KEY') : [fKey, cfg.llm.hasKey ? h('button', { class: 'danger sm', onclick: async () => { if (await confirmDlg('Supprimer la clé API ?', 'L’application passera en mode hors-ligne.', 'Supprimer', true)) { await api('setSettings', { llm: { clearKey: true } }); go('settings'); } } }, 'Supprimer la clé enregistrée') : null],
      h('p', { class: 'small muted' }, 'La clé est chiffrée avec Windows (DPAPI). Seuls les extraits nécessaires à une requête sont envoyés à l’API ; sans clé, rien ne quitte votre machine.'), mrows,
      h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { class: 'grow' }, fBJ), h('div', { class: 'grow' }, fBM), h('div', { class: 'grow' }, fCo))),
    h('div', { class: 'card' }, h('h2', null, 'Extraction et recherche'), h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { class: 'grow' }, fMer), h('div', { class: 'grow' }, fRev), h('div', { class: 'grow' }, fCon)), h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { class: 'grow' }, fTop), h('div', { class: 'grow' }, fDep), h('div', { class: 'grow' }, fRes))),
    h('div', { class: 'card' }, h('h2', null, 'Reconnaissance de texte (OCR)'),
      h('label', { class: 'row' }, ocrOn, 'Lire les pages de PDF scannés'),
      h('label', { class: 'row', style: 'margin-top:8px' }, ocrImg, 'Lire aussi les images du coffre (PNG, JPG) — plus long'),
      h('label', { class: 'field' }, h('span', null, 'Langues'), ocrLang),
      h('p', { class: 'small muted' }, 'Traitement entièrement local : aucune image n’est envoyée à l’extérieur. Les données de langue sont incluses dans l’application.')),
    h('div', { class: 'card' }, h('h2', null, 'Automatisation'),
      h('label', { class: 'row' }, wOn, 'Réingérer automatiquement 20 s après une modification dans le coffre'), fEv,
      h('label', { class: 'row' }, tOn, 'Rester en arrière-plan (zone de notification) à la fermeture de la fenêtre'),
      h('label', { class: 'row', style: 'margin-top:8px' }, sOn, 'Lancer avec Windows (en arrière-plan)'),
      h('p', { class: 'small muted' }, 'L’ingestion automatique ne tourne que lorsque l’application est ouverte ou en arrière-plan.')),
    h('div', { class: 'card' }, h('h2', null, 'Apparence'), h('label', { class: 'field' }, h('span', null, 'Thème'), theme)),
    h('div', { class: 'card' }, h('h2', null, 'Utiliser avec Claude Desktop ou Claude Code (MCP)'), h('p', { class: 'small muted' }, 'Ajoutez ce bloc à la configuration MCP de Claude Desktop (claude_desktop_config.json). Claude pourra alors interroger votre base avec citations ; l’accès est en lecture seule.'),
      info.portable ? h('p', { class: 'chip warn' }, 'Version portable : le chemin du script change à chaque lancement. Pour le MCP, utilisez plutôt l’installateur.') : null,
      h('pre', { class: 'mono card', style: 'white-space:pre-wrap;box-shadow:none;margin:0' }, mcpCmd),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { onclick: () => { navigator.clipboard.writeText(mcpCmd); toast('Copié', 'ok'); } }, 'Copier la configuration'), h('button', { onclick: () => { navigator.clipboard.writeText(`claude mcp add graphrag -e ELECTRON_RUN_AS_NODE=1 -- "${info.exe}" "${info.mcpScript}"`); toast('Commande copiée', 'ok'); } }, 'Copier la commande Claude Code'))),
    h('div', { class: 'card' }, h('h2', null, 'API HTTP locale'), h('label', { class: 'row' }, httpOn, 'Activer l’API HTTP (127.0.0.1 uniquement, jeton obligatoire)'), fPort,
      h('div', { class: 'small' }, 'Jeton : ', h('span', { class: 'mono' }, cfg.server.token), ' ', h('button', { class: 'sm', onclick: () => { navigator.clipboard.writeText(cfg.server.token); toast('Jeton copié', 'ok'); } }, 'Copier')),
      h('p', { class: 'small muted' }, 'Exemple : POST http://127.0.0.1:' + cfg.server.port + '/api/ask  avec l’en-tête Authorization: Bearer <jeton> et le corps {"args":["ma question"]}. Description OpenAPI : GET /api/openapi.json.')));
}

// ───────────────────────── démarrage
function applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

(async function boot() {
  window.app.on((t, p) => {
    if (t === 'nav') go(p);
    if (t === 'toast') toast(p.text, p.kind);
    if (t === 'progress' && state.status) { state.status.progress = p; if (state.page !== 'ingest') { const b = $('#statusbox'); if (b) renderNav(); } }
  });
  try { const s = await api('getSettings'); applyTheme(s.ui.theme); state.settings = s; } catch { /* premier lancement */ }
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && /^[1-6]$/.test(e.key)) { e.preventDefault(); go(PAGES[Number(e.key) - 1][0]); } });
  await go('chat');
})();
