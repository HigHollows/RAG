'use strict';
// Algorithmes de graphe : Louvain déterministe (2 niveaux), voisinage, plus court chemin, centralité.

/**
 * @param {number} n nombre de nœuds (0..n-1)
 * @param {[number,number,number][]} edges
 * @returns {number[][]} levels : pour chaque passe, communauté de chaque nœud d'origine
 */
function louvain(n, edges, resolution = 1) {
  let adj = Array.from({ length: n }, () => new Map());
  let self = new Array(n).fill(0);
  for (const [a, b, w] of edges) {
    if (a === b) continue;
    adj[a].set(b, (adj[a].get(b) || 0) + w);
    adj[b].set(a, (adj[b].get(a) || 0) + w);
  }
  let nodeMap = Array.from({ length: n }, (_, i) => i);
  const levels = [];
  for (let pass = 0; pass < 10; pass++) {
    const N = adj.length;
    const deg = adj.map((m, i) => {
      let s = 2 * self[i];
      for (const w of m.values()) s += w;
      return s;
    });
    const m2 = deg.reduce((a, b) => a + b, 0);
    if (m2 === 0) break;
    const comm = Array.from({ length: N }, (_, i) => i);
    const tot = deg.slice();
    let movedAny = false;
    for (let iter = 0; iter < 50; iter++) {
      let moved = false;
      for (let i = 0; i < N; i++) {
        const ci = comm[i];
        const kin = new Map();
        for (const [j, w] of adj[i]) kin.set(comm[j], (kin.get(comm[j]) || 0) + w);
        tot[ci] -= deg[i];
        let best = ci;
        let bestGain = (kin.get(ci) || 0) - (resolution * tot[ci] * deg[i]) / m2;
        for (const c of [...kin.keys()].sort((a, b) => a - b)) {
          const gain = kin.get(c) - (resolution * tot[c] * deg[i]) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            best = c;
          }
        }
        tot[best] += deg[i];
        if (best !== ci) {
          comm[i] = best;
          moved = true;
          movedAny = true;
        }
      }
      if (!moved) break;
    }
    if (!movedAny) break;
    const ren = new Map();
    for (let i = 0; i < N; i++) if (!ren.has(comm[i])) ren.set(comm[i], ren.size);
    const c2 = comm.map((c) => ren.get(c));
    nodeMap = nodeMap.map((x) => c2[x]);
    levels.push(nodeMap.slice());
    const K = ren.size;
    if (K === N) break;
    const nadj = Array.from({ length: K }, () => new Map());
    const nself = new Array(K).fill(0);
    for (let i = 0; i < N; i++) {
      nself[c2[i]] += self[i];
      for (const [j, w] of adj[i]) {
        if (j < i) continue;
        if (c2[i] === c2[j]) nself[c2[i]] += w;
        else {
          nadj[c2[i]].set(c2[j], (nadj[c2[i]].get(c2[j]) || 0) + w);
          nadj[c2[j]].set(c2[i], (nadj[c2[j]].get(c2[i]) || 0) + w);
        }
      }
    }
    adj = nadj;
    self = nself;
    if (K === 1) break;
  }
  return levels;
}

/** Voisinage jusqu'à `depth`, plafonné, priorisé par confiance et degré. */
function neighborhood(store, entityIds, depth = 1, maxNodes = 25) {
  const seen = new Map(); // id -> distance
  entityIds.forEach((id) => seen.set(id, 0));
  const edges = new Map();
  let frontier = [...entityIds];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const cand = new Map();
    for (const id of frontier) {
      const rows = store.all(
        `SELECT r.id, r.subj, r.pred, r.obj, r.confidence, r.quote, r.chunk_id FROM relations r WHERE r.subj=? OR r.obj=?`,
        id,
        id
      );
      for (const r of rows) {
        edges.set(r.id, r);
        const other = r.subj === id ? r.obj : r.subj;
        if (!seen.has(other)) cand.set(other, Math.max(cand.get(other) || 0, r.confidence));
      }
    }
    const ranked = [...cand.entries()]
      .map(([id, conf]) => ({ id, score: conf + Math.log1p(store.get('SELECT COUNT(*) c FROM relations WHERE subj=? OR obj=?', id, id).c) * 0.2 }))
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .slice(0, Math.max(0, maxNodes - seen.size));
    frontier = ranked.map((x) => x.id);
    frontier.forEach((id) => seen.set(id, d));
  }
  const ids = new Set(seen.keys());
  return { nodes: [...seen.entries()].map(([id, distance]) => ({ id, distance })), edges: [...edges.values()].filter((e) => ids.has(e.subj) && ids.has(e.obj)) };
}

/** BFS non orienté ; renvoie la liste d'arêtes du plus court chemin (ou null). */
function shortestPath(store, from, to, maxDepth = 6) {
  if (from === to) return { nodes: [from], edges: [] };
  const prev = new Map([[from, null]]);
  let frontier = [from];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const rows = store.all('SELECT id, subj, pred, obj, quote, chunk_id, confidence FROM relations WHERE subj=? OR obj=? ORDER BY confidence DESC, id', id, id);
      for (const r of rows) {
        const o = r.subj === id ? r.obj : r.subj;
        if (prev.has(o)) continue;
        prev.set(o, { via: id, edge: r });
        if (o === to) {
          const nodes = [to];
          const edges = [];
          for (let c = to; prev.get(c); c = prev.get(c).via) {
            edges.unshift(prev.get(c).edge);
            nodes.unshift(prev.get(c).via);
          }
          return { nodes, edges };
        }
        next.push(o);
      }
    }
    frontier = next;
  }
  return null;
}

/** Degré pondéré de chaque entité (centralité simple). */
function degrees(store) {
  const m = new Map();
  for (const r of store.all('SELECT subj, obj FROM relations')) {
    m.set(r.subj, (m.get(r.subj) || 0) + 1);
    m.set(r.obj, (m.get(r.obj) || 0) + 1);
  }
  return m;
}

module.exports = { louvain, neighborhood, shortestPath, degrees };
