'use strict';
// Client LLM (API Claude) : cache disque, budget, journal des coûts, réessais avec backoff.
// Le transport est injectable : les tests utilisent un LLM simulé et n'appellent jamais l'API.

const crypto = require('crypto');

const SCHEMA_VERSION = 'v1';
const approxTokens = (s) => Math.ceil((s || '').length / 4);

class BudgetError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'BudgetError';
  }
}

async function httpTransport({ apiKey, model, system, prompt, maxTokens, temperature, signal, onToken }) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: prompt }],
  };
  if (onToken) body.stream = true;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`API ${res.status}: ${t.slice(0, 300)}`);
    err.status = res.status;
    err.retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw err;
  }
  if (!onToken) {
    const j = await res.json();
    return { text: (j.content || []).map((c) => c.text || '').join(''), usage: { in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0 } };
  }
  // flux SSE
  let text = '';
  const usage = { in: 0, out: 0 };
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === 'content_block_delta' && ev.delta?.text) {
          text += ev.delta.text;
          onToken(ev.delta.text);
        } else if (ev.type === 'message_start') usage.in = ev.message?.usage?.input_tokens || 0;
        else if (ev.type === 'message_delta') usage.out = ev.usage?.output_tokens || usage.out;
      } catch {
        /* ligne partielle */
      }
    }
  }
  return { text, usage };
}

class LLM {
  constructor(store, config, transport) {
    this.store = store;
    this.config = config;
    this.transport = transport || httpTransport;
    this.jobSpent = 0;
    this.jobBudget = Infinity;
    this.abort = null;
    this.stats = { calls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
  }

  get cfg() {
    return this.config.data.llm;
  }

  available() {
    return !!(this.cfg.enabled && (this.config.apiKey() || this.transport !== httpTransport));
  }

  startJob(budget) {
    this.jobSpent = 0;
    this.jobBudget = budget ?? this.cfg.budgetPerJob;
    this.stats = { calls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
    this.abort = new AbortController();
  }

  cancel() {
    if (this.abort) this.abort.abort();
  }

  price(model) {
    return this.cfg.prices[model] || { in: 3, out: 15 };
  }

  estimateCost(model, tokensIn, tokensOut) {
    const p = this.price(model);
    return (tokensIn * p.in + tokensOut * p.out) / 1e6;
  }

  monthSpent() {
    const r = this.store.get("SELECT COALESCE(SUM(cost),0) c FROM cost_log WHERE ts >= date('now','start of month')");
    return r.c;
  }

  checkBudget(extra = 0) {
    if (this.jobSpent + extra > this.jobBudget) throw new BudgetError(`Budget de l'ingestion atteint (${this.jobBudget.toFixed(2)} $)`);
    if (this.monthSpent() + extra > this.cfg.budgetPerMonth) throw new BudgetError(`Budget mensuel atteint (${this.cfg.budgetPerMonth} $)`);
  }

  /**
   * @param {{step:string, model:string, system:string, prompt:string, maxTokens?:number, cache?:boolean, onToken?:Function}} o
   */
  async complete(o) {
    const model = o.model;
    const useCache = o.cache !== false && !o.onToken;
    const key = crypto.createHash('sha256').update([model, SCHEMA_VERSION, o.system, o.prompt].join('\u0001')).digest('hex');
    if (useCache) {
      const hit = this.store.get('SELECT response FROM llm_cache WHERE key=?', key);
      if (hit) {
        this.stats.cacheHits++;
        return hit.response;
      }
    }
    const est = this.estimateCost(model, approxTokens(o.system) + approxTokens(o.prompt), o.maxTokens || 1024);
    this.checkBudget(est * 0.5);
    if (!this.available()) throw new Error("Aucune clé API Claude configurée (Réglages > Modèles).");

    let attempt = 0;
    for (;;) {
      try {
        const r = await this.transport({
          apiKey: this.config.apiKey(),
          model,
          system: o.system,
          prompt: o.prompt,
          maxTokens: o.maxTokens || 1024,
          temperature: this.cfg.temperature,
          signal: this.abort?.signal,
          onToken: o.onToken,
        });
        const usage = r.usage || { in: approxTokens(o.prompt), out: approxTokens(r.text) };
        const cost = this.estimateCost(model, usage.in, usage.out);
        this.jobSpent += cost;
        this.stats.calls++;
        this.stats.tokensIn += usage.in;
        this.stats.tokensOut += usage.out;
        this.stats.cost += cost;
        this.store.run('INSERT INTO cost_log(model,tokens_in,tokens_out,cost,step) VALUES(?,?,?,?,?)', model, usage.in, usage.out, cost, o.step || '');
        if (useCache) this.store.run('INSERT OR REPLACE INTO llm_cache(key,response) VALUES(?,?)', key, r.text);
        return r.text;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        const retriable = !e.status || e.status === 429 || e.status >= 500 || e.status === 529;
        if (!retriable || ++attempt > 4) throw e;
        const wait = Math.max(e.retryAfter * 1000 || 0, 1000 * 2 ** attempt + Math.random() * 400);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  /** Appelle le LLM et renvoie un JSON validé ; une seconde tentative reçoit le message d'erreur. */
  async completeJSON(o, validate) {
    let prompt = o.prompt;
    let lastErr = null;
    for (let i = 0; i < 2; i++) {
      const text = await this.complete({ ...o, prompt, cache: i === 0 });
      try {
        const obj = parseJSONLoose(text);
        return validate ? validate(obj) : obj;
      } catch (e) {
        lastErr = e;
        prompt = o.prompt + `\n\nTa réponse précédente était invalide (${e.message}). Réponds uniquement avec un JSON valide conforme au schéma.`;
      }
    }
    const err = new Error('JSON invalide : ' + lastErr.message);
    err.invalidJSON = true;
    throw err;
  }
}

function parseJSONLoose(text) {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('aucun objet JSON');
  return JSON.parse(t.slice(a, b + 1));
}

module.exports = { LLM, BudgetError, parseJSONLoose, approxTokens, httpTransport };
