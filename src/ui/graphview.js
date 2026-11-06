'use strict';
// Vue graphe : canvas 2D, disposition à forces, zoom/pan/glisser, sélection, chemin surligné. Aucune dépendance.

class GraphView {
  constructor(canvas, { onSelect, onHover } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect || (() => {});
    this.nodes = []; this.edges = [];
    this.view = { x: 0, y: 0, k: 1 };
    this.selected = null; this.hover = null; this.pathIds = new Set(); this.pathEdges = new Set();
    this.colorBy = 'community';
    this.alpha = 0; this.raf = 0; this.drag = null;
    this._bind();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
  }

  static palette(i) { return ['#526B5B', '#6F86A0', '#B08D57', '#A5675C', '#7D6B8A', '#5F8A8B', '#9A8F6B', '#8C7D74', '#6B7F5E', '#A07A8E'][Math.abs(i) % 10]; }

  setData(nodes, edges) {
    const old = new Map(this.nodes.map((n) => [n.id, n]));
    const R = Math.sqrt(nodes.length) * 28 + 40;
    this.nodes = nodes.map((n, i) => {
      const o = old.get(n.id);
      const a = i * 2.399963;
      return { ...n, x: o ? o.x : Math.cos(a) * R * Math.sqrt((i + 1) / nodes.length), y: o ? o.y : Math.sin(a) * R * Math.sqrt((i + 1) / nodes.length), vx: 0, vy: 0, r: 4 + Math.min(14, Math.sqrt(n.degree) * 2.2) };
    });
    const idx = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = edges.map((e) => ({ ...e, s: idx.get(e.source), t: idx.get(e.target) })).filter((e) => e.s && e.t);
    this.adj = new Map(this.nodes.map((n) => [n.id, new Set()]));
    this.edges.forEach((e) => { this.adj.get(e.source).add(e.target); this.adj.get(e.target).add(e.source); });
    this.types = [...new Set(nodes.map((n) => n.type))].sort();
    this.selected = null; this.pathIds = new Set(); this.pathEdges = new Set();
    this.alpha = 1;
    this.fit(true);
    this._loop();
  }

  colorOf(n) {
    if (this.colorBy === 'type') return GraphView.palette(this.types.indexOf(n.type) + 3);
    return n.community ? GraphView.palette(n.community) : '#B5B5B0';
  }

  legend() {
    if (this.colorBy === 'type') return this.types.map((t) => ({ label: t, color: GraphView.palette(this.types.indexOf(t) + 3) }));
    const seen = new Map();
    this.nodes.forEach((n) => { if (n.community && !seen.has(n.community)) seen.set(n.community, n.community); });
    return [...seen.keys()].slice(0, 12).map((c) => ({ label: 'Communauté ' + c, color: GraphView.palette(c) }));
  }

  highlightPath(ids) {
    this.pathIds = new Set(ids);
    this.pathEdges = new Set();
    for (let i = 0; i + 1 < ids.length; i++) this.pathEdges.add(ids[i] + ':' + ids[i + 1]).add(ids[i + 1] + ':' + ids[i]);
    this._draw();
  }

  select(id, center) {
    this.selected = id;
    const n = this.nodes.find((x) => x.id === id);
    if (n && center) { this.view.x = this.w / 2 - n.x * this.view.k; this.view.y = this.h / 2 - n.y * this.view.k; }
    this._draw();
  }

  fit(soft) {
    if (!this.nodes.length || !this.w) return;
    const xs = this.nodes.map((n) => n.x), ys = this.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = Math.min(this.w / (maxX - minX + 120), this.h / (maxY - minY + 120), soft ? 1.2 : 2);
    this.view = { k, x: this.w / 2 - ((minX + maxX) / 2) * k, y: this.h / 2 - ((minY + maxY) / 2) * k };
    this._draw();
  }

  toDataURL() { return this.c.toDataURL('image/png'); }

  _resize() {
    const p = this.c.parentElement;
    const dpr = window.devicePixelRatio || 1;
    this.w = p.clientWidth; this.h = p.clientHeight;
    this.c.width = this.w * dpr; this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._draw();
  }

  _tick() {
    const N = this.nodes, a = this.alpha;
    const n = N.length;
    const cell = 90, grid = new Map();
    for (const p of N) { const k = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
    for (const p of N) {
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const g = grid.get((gx + dx) + ',' + (gy + dy));
        if (!g) continue;
        for (const q of g) {
          if (q === p) continue;
          let ddx = p.x - q.x, ddy = p.y - q.y;
          let d2 = ddx * ddx + ddy * ddy;
          if (d2 > cell * cell) continue;
          if (d2 < 1) { ddx = Math.random() - .5; ddy = Math.random() - .5; d2 = 1; }
          const f = (900 * a) / d2;
          p.vx += ddx * f; p.vy += ddy * f;
        }
      }
    }
    for (const e of this.edges) {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 70) / d) * 0.06 * a;
      e.s.vx += dx * f; e.s.vy += dy * f; e.t.vx -= dx * f; e.t.vy -= dy * f;
    }
    for (const p of N) {
      p.vx -= p.x * 0.004 * a; p.vy -= p.y * 0.004 * a;
      if (this.drag && this.drag.node === p) { p.vx = p.vy = 0; continue; }
      p.vx *= 0.82; p.vy *= 0.82;
      p.x += p.vx; p.y += p.vy;
    }
    this.alpha *= 0.985;
    return n;
  }

  _loop() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.alpha > 0.02 || this.drag) {
        this._tick(); this._tick();
        if (this.alpha > 0.5 && this.nodes.length > 0 && !this._fitted) { /* ajustement progressif */ }
        this._draw();
        this.raf = requestAnimationFrame(step);
      } else { this._draw(); }
    };
    this.raf = requestAnimationFrame(step);
    setTimeout(() => this.fit(true), 700);
  }

  _toWorld(px, py) { return { x: (px - this.view.x) / this.view.k, y: (py - this.view.y) / this.view.k }; }

  _pick(px, py) {
    const w = this._toWorld(px, py);
    let best = null, bd = 1e9;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < n.r + 5 / this.view.k && d < bd) { best = n; bd = d; }
    }
    return best;
  }

  _bind() {
    const c = this.c;
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e);
      const n = this._pick(x, y);
      c.setPointerCapture(e.pointerId);
      this.drag = n ? { node: n, moved: false } : { pan: true, x, y, vx: this.view.x, vy: this.view.y, moved: false };
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (this.drag) {
        this.drag.moved = true;
        if (this.drag.node) { const w = this._toWorld(x, y); this.drag.node.x = w.x; this.drag.node.y = w.y; this.alpha = Math.max(this.alpha, 0.3); this._loop(); }
        else { this.view.x = this.drag.vx + x - this.drag.x; this.view.y = this.drag.vy + y - this.drag.y; this._draw(); }
        return;
      }
      const h = this._pick(x, y);
      if (h !== this.hover) { this.hover = h; c.style.cursor = h ? 'pointer' : 'grab'; this._draw(); if (this.onHover) this.onHover(h, e); }
    });
    c.addEventListener('pointerup', (e) => {
      const d = this.drag; this.drag = null; c.style.cursor = 'grab';
      if (d && !d.moved) { const [x, y] = pos(e); const n = this._pick(x, y); this.selected = n ? n.id : null; this.onSelect(n); this._draw(); }
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      const f = Math.exp(-e.deltaY * 0.0015);
      const k = Math.max(0.1, Math.min(6, this.view.k * f));
      this.view.x = x - ((x - this.view.x) / this.view.k) * k;
      this.view.y = y - ((y - this.view.y) / this.view.k) * k;
      this.view.k = k; this._draw();
    }, { passive: false });
    c.tabIndex = 0;
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', 'Graphe de connaissances. Utilisez la recherche ou la liste pour naviguer au clavier.');
    c.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') { this.view.k *= 1.2; this._draw(); }
      else if (e.key === '-') { this.view.k /= 1.2; this._draw(); }
      else if (e.key === '0') this.fit();
    });
  }

  _draw() {
    const ctx = this.ctx, v = this.view;
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--text').trim() || '#222', mut = css.getPropertyValue('--muted').trim() || '#888', acc = css.getPropertyValue('--accent').trim() || '#55f';
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(v.x, v.y); ctx.scale(v.k, v.k);
    const sel = this.selected, near = sel != null ? this.adj.get(sel) : null;
    const hasPath = this.pathIds.size > 0;
    ctx.lineWidth = 1 / v.k;
    for (const e of this.edges) {
      const onPath = hasPath && this.pathEdges.has(e.source + ':' + e.target);
      const hot = sel != null && (e.source === sel || e.target === sel);
      ctx.globalAlpha = onPath || hot ? 1 : (sel != null || hasPath ? 0.1 : 0.32);
      ctx.strokeStyle = onPath ? acc : hot ? acc : mut;
      ctx.lineWidth = (onPath ? 3 : hot ? 1.6 : Math.min(2.4, 0.7 + e.w * 0.25)) / v.k;
      ctx.beginPath(); ctx.moveTo(e.s.x, e.s.y); ctx.lineTo(e.t.x, e.t.y); ctx.stroke();
    }
    const top = new Set([...this.nodes].sort((a, b) => b.degree - a.degree).slice(0, 25).map((n) => n.id));
    for (const n of this.nodes) {
      const dim = (sel != null && n.id !== sel && !near.has(n.id)) || (hasPath && !this.pathIds.has(n.id));
      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.fillStyle = this.colorOf(n);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.2832); ctx.fill();
      if (n.isNote) { ctx.strokeStyle = text; ctx.globalAlpha = dim ? 0.1 : 0.55; ctx.lineWidth = 1 / v.k; ctx.stroke(); }
      if (n.id === sel || n === this.hover || this.pathIds.has(n.id)) { ctx.globalAlpha = 1; ctx.strokeStyle = acc; ctx.lineWidth = 2.5 / v.k; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 / v.k, 0, 6.2832); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = text; ctx.textAlign = 'center';
    const fs = Math.max(10, 12 / Math.sqrt(v.k));
    ctx.font = `${fs}px "Segoe UI", sans-serif`;
    for (const n of this.nodes) {
      const show = n.id === sel || n === this.hover || this.pathIds.has(n.id) || (v.k > 0.55 && top.has(n.id)) || v.k > 1.6 || (sel != null && near.has(n.id) && v.k > 0.4);
      if (!show) continue;
      ctx.globalAlpha = (sel != null && n.id !== sel && !near.has(n.id)) ? 0.3 : 1;
      ctx.fillText(n.name.length > 28 ? n.name.slice(0, 27) + '…' : n.name, n.x, n.y + n.r + fs + 1);
    }
    ctx.restore();
  }
}

window.GraphView = GraphView;
