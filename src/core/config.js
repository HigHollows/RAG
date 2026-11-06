'use strict';
// Configuration centralisée (JSON dans le dossier de données de l'utilisateur).

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  vaults: [], // { name, path, exclude: [], extensions: [] }
  llm: {
    enabled: true,
    apiKey: '', // jamais écrit en clair : chiffré par main.js (safeStorage) ou lu depuis ANTHROPIC_API_KEY
    models: {
      extract: 'claude-haiku-5-5',
      summary: 'claude-haiku-5-5',
      answer: 'claude-sonnet-5-5',
      global: 'claude-sonnet-5-5',
      judge: 'claude-haiku-5-5',
    },
    // prix indicatifs en USD par million de tokens (modifiables dans Réglages)
    prices: {
      'claude-haiku-5-5': { in: 1, out: 5 },
      'claude-sonnet-5-5': { in: 3, out: 15 },
      'claude-opus-5-5': { in: 15, out: 75 },
    },
    temperature: 0,
    budgetPerJob: 5,
    budgetPerMonth: 20,
    concurrency: 3,
  },
  chunking: { targetTokens: 650, overlap: 0.12 },
  extraction: {
    entityTypes: ['Personne', 'Organisation', 'Projet', 'Concept', 'Lieu', 'Événement', 'Œuvre', 'Outil', 'Autre'],
    relationTypes: ['travaille_avec', 'fait_partie_de', 'dépend_de', 'cause', 'contredit', 'soutient', 'est_un', 'mentionne', 'date_de', 'lié_à'],
    minConfidence: 0.5,
    mergeThreshold: 0.9,
    reviewThreshold: 0.8,
    maxChunksPerNoteLLM: 40,
  },
  retrieval: { topChunks: 8, depth: 1, maxNeighbors: 25, contextTokens: 6000, globalCommunities: 6 },
  communities: { resolution: 1.0, regenThreshold: 0.2, minSize: 2 },
  server: { http: false, port: 7474, token: '' },
  logging: { level: 'info', logContent: false },
  backups: { keep: 5 },
  ui: { theme: 'auto' },
  ocr: { enabled: true, images: false, languages: 'fra+eng', maxPages: 300, scale: 2 },
  auto: { watch: false, everyMinutes: 0, tray: false, startWithWindows: false },
};

function deepMerge(base, over) {
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(base)) return over === undefined ? structuredClone(base) : structuredClone(over);
  const out = structuredClone(base);
  for (const k of Object.keys(over || {})) out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : structuredClone(over[k]);
  return out;
}

class Config {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'config.json');
    this.data = deepMerge(DEFAULTS, {});
    this.secrets = { encrypt: (s) => Buffer.from(s, 'utf8').toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString('utf8'), secure: false };
    this.load();
  }

  setSecrets(s) {
    this.secrets = s;
    this.load();
  }

  load() {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      /* première exécution */
    }
    const enc = raw.llm && raw.llm.apiKeyEnc;
    if (raw.llm) delete raw.llm.apiKeyEnc;
    this.data = deepMerge(DEFAULTS, raw);
    if (enc) {
      try {
        this.data.llm.apiKey = this.secrets.decrypt(enc);
      } catch {
        this.data.llm.apiKey = '';
      }
    }
    if (!this.data.server.token) this.data.server.token = require('crypto').randomBytes(16).toString('hex');
    return this.data;
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const copy = JSON.parse(JSON.stringify(this.data));
    if (copy.llm.apiKey) copy.llm.apiKeyEnc = this.secrets.encrypt(copy.llm.apiKey);
    delete copy.llm.apiKey;
    fs.writeFileSync(this.file, JSON.stringify(copy, null, 2));
  }

  update(patch) {
    this.data = deepMerge(this.data, patch);
    // les listes de coffres sont remplacées, pas fusionnées
    if (patch.vaults) this.data.vaults = patch.vaults;
    this.save();
    return this.data;
  }

  apiKey() {
    return process.env.ANTHROPIC_API_KEY || this.data.llm.apiKey || '';
  }

  /** Version sans secret, pour l'interface. */
  publicView() {
    const c = JSON.parse(JSON.stringify(this.data));
    c.llm.hasKey = !!this.apiKey();
    c.llm.keyFromEnv = !!process.env.ANTHROPIC_API_KEY;
    delete c.llm.apiKey;
    return c;
  }
}

module.exports = { Config, DEFAULTS, deepMerge };
