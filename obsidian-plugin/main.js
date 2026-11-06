'use strict';
// Plugin Obsidian : client léger de l'API HTTP locale de GraphRAG Studio (aucune logique métier ici).
// Prérequis : GraphRAG Studio > Réglages > « Activer l'API HTTP », puis copier le jeton dans les réglages du plugin.
const { Plugin, ItemView, Modal, Notice, PluginSettingTab, Setting, requestUrl } = require('obsidian');

const VIEW = 'graphrag-studio-view';
const DEFAULTS = { port: 7474, token: '' };

class Api {
  constructor(plugin) { this.p = plugin; }
  async call(method, ...args) {
    const { port, token } = this.p.settings;
    if (!token) throw new Error("Jeton manquant : renseignez-le dans les réglages du plugin.");
    let r;
    try {
      r = await requestUrl({ url: `http://127.0.0.1:${port}/api/${method}`, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ args }), throw: false });
    } catch { throw new Error('GraphRAG Studio est injoignable : ouvrez l’application et activez l’API HTTP.'); }
    if (r.status === 401) throw new Error('Jeton invalide.');
    if (r.status >= 400) throw new Error((r.json && r.json.error && r.json.error.message) || 'Erreur ' + r.status);
    return r.json.result;
  }
}

class AskView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'GraphRAG'; }
  getIcon() { return 'git-fork'; }
  async onOpen() {
    const root = this.contentEl; root.empty(); root.addClass('grag-view');
    const ta = root.createEl('textarea', { attr: { placeholder: 'Posez une question sur vos notes…' } });
    const btn = root.createEl('button', { text: 'Demander', cls: 'mod-cta' });
    const out = root.createDiv();
    const go = async () => {
      const q = ta.value.trim(); if (!q) return;
      out.empty(); out.createDiv({ text: 'Recherche…' }); btn.disabled = true;
      try { this.render(out, await this.plugin.api.call('ask', q, {})); }
      catch (e) { out.empty(); out.createDiv({ text: e.message }); }
      btn.disabled = false;
    };
    btn.onclick = go;
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); });
    if (this.plugin.pending) { ta.value = this.plugin.pending; this.plugin.pending = null; go(); }
  }
  render(out, r) {
    out.empty();
    out.createDiv({ cls: 'grag-answer', text: r.answer });
    if (r.offline) out.createDiv({ cls: 'grag-chip', text: 'hors-ligne (pas de clé API)' });
    r.citations.forEach((c) => {
      const d = out.createDiv({ cls: 'grag-src' });
      d.createEl('b', { text: `[${c.n}] ${c.title}` });
      d.createDiv({ cls: 'grag-ex', text: c.excerpt });
      const a = d.createEl('a', { text: 'Ouvrir la note', href: '#' });
      a.onclick = (e) => { e.preventDefault(); this.app.workspace.openLinkText(c.path.replace(/\.md$/, ''), '', false); };
    });
  }
}

class NoteModal extends Modal {
  constructor(app, plugin, file) { super(app); this.plugin = plugin; this.file = file; }
  async onOpen() {
    const { contentEl } = this; contentEl.createEl('h3', { text: 'Entités de ' + this.file.basename });
    try {
      const n = await this.plugin.api.call('note', this.file.path);
      if (!n) { contentEl.createDiv({ text: 'Note non encore ingérée : lancez une ingestion dans GraphRAG Studio.' }); return; }
      const box = contentEl.createDiv();
      n.entities.forEach((e) => box.createSpan({ cls: 'grag-chip', text: `${e.name} · ${e.type}` }));
      contentEl.createEl('h4', { text: 'Liens entrants' });
      n.backlinks.forEach((b) => { const a = contentEl.createEl('div').createEl('a', { text: b.title, href: '#' }); a.onclick = (ev) => { ev.preventDefault(); this.app.workspace.openLinkText(b.path.replace(/\.md$/, ''), '', false); this.close(); }; });
      const ask = contentEl.createEl('button', { text: 'Résumer cette note avec GraphRAG' });
      ask.onclick = () => { this.close(); this.plugin.openAsk('Résume la note « ' + n.title + ' » et ses liens.'); };
    } catch (e) { contentEl.createDiv({ text: e.message }); }
  }
}

class Tab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    new Setting(containerEl).setName('Port de l’API').addText((t) => t.setValue(String(this.plugin.settings.port)).onChange(async (v) => { this.plugin.settings.port = Number(v) || 7474; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Jeton d’API').setDesc('GraphRAG Studio > Réglages > API HTTP locale').addText((t) => t.setValue(this.plugin.settings.token).onChange(async (v) => { this.plugin.settings.token = v.trim(); await this.plugin.saveSettings(); }));
  }
}

module.exports = class GraphRagPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.api = new Api(this);
    this.registerView(VIEW, (leaf) => new AskView(leaf, this));
    this.addRibbonIcon('git-fork', 'GraphRAG : poser une question', () => this.openAsk());
    this.addCommand({ id: 'ask', name: 'Poser une question', callback: () => this.openAsk() });
    this.addCommand({ id: 'note-entities', name: 'Entités de cette note', callback: () => { const f = this.app.workspace.getActiveFile(); if (f) new NoteModal(this.app, this, f).open(); else new Notice('Aucune note active'); } });
    this.addSettingTab(new Tab(this.app, this));
  }
  async openAsk(q) {
    this.pending = q || null;
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW, active: true }); }
    this.app.workspace.revealLeaf(leaf);
    if (q && leaf.view && leaf.view.onOpen) await leaf.view.onOpen();
  }
  async saveSettings() { await this.saveData(this.settings); }
};
