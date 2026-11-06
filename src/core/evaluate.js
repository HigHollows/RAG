'use strict';
// Suite d'évaluation : rappel des sources, validité des citations, refus hors-corpus, fidélité (juge LLM optionnel).

const fs = require('fs');
const path = require('path');
const { norm } = require('./embed');
const { cleanMd } = require('./answer');

/** questions : [{ q, expected: ["chemin.md"], outOfCorpus?: bool, reference?: string }] */
async function runEval(core, questions, { judge = true } = {}) {
  const rows = [];
  for (const item of questions) {
    const r = await core.ask(item.q);
    const cited = r.citations.map((c) => c.path);
    const recall = item.expected && item.expected.length ? item.expected.filter((e) => cited.some((c) => c.endsWith(e))).length / item.expected.length : null;
    let validCit = 0;
    for (const c of r.citations) {
      const ch = core.chunk(c.chunkId);
      const probe = norm(c.excerpt.replace(/…$/, '')).replace(/\s+/g, ' ').slice(0, 60);
      if (ch && norm(cleanMd(ch.text)).includes(probe)) validCit++;
    }
    let faithful = null;
    if (judge && !r.offline && !item.outOfCorpus && core.llm.available() && r.citations.length) {
      try {
        const ctx = r.citations.map((c) => `[${c.n}] ${core.chunk(c.chunkId)?.text || ''}`).join('\n');
        const v = await core.llm.complete({ step: 'évaluation', model: core.config.data.llm.models.judge, system: 'Tu es un juge strict. Réponds par un seul mot : FIDELE ou INFIDELE.', prompt: `Sources :\n${ctx}\n\nRéponse à juger :\n${r.answer}\n\nLa réponse est-elle entièrement soutenue par les sources ?`, maxTokens: 10 });
        faithful = /^\s*FIDELE/i.test(norm(v).toUpperCase());
      } catch { /* juge indisponible */ }
    }
    rows.push({ q: item.q, mode: r.mode, recall, citations: r.citations.length, validCit, refused: !!r.noEvidence, outOfCorpus: !!item.outOfCorpus, faithful, offline: r.offline });
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const inCorpus = rows.filter((r) => !r.outOfCorpus);
  const out = rows.filter((r) => r.outOfCorpus);
  const f = rows.filter((r) => r.faithful !== null);
  const summary = {
    total: rows.length,
    sourceRecall: avg(inCorpus.filter((r) => r.recall !== null).map((r) => r.recall)),
    citationValidity: rows.reduce((a, r) => a + r.citations, 0) ? rows.reduce((a, r) => a + r.validCit, 0) / rows.reduce((a, r) => a + r.citations, 0) : null,
    correctRefusals: out.length ? out.filter((r) => r.refused).length / out.length : null,
    faithfulness: f.length ? f.filter((r) => r.faithful).length / f.length : null,
  };
  const pct = (x) => (x === null ? 'n/a' : (x * 100).toFixed(0) + ' %');
  const md = `# Rapport d'évaluation — ${new Date().toISOString().slice(0, 10)}\n\n- Questions : ${summary.total}\n- Rappel des sources : ${pct(summary.sourceRecall)}\n- Citations valides : ${pct(summary.citationValidity)}\n- « Je ne sais pas » correct (hors corpus) : ${pct(summary.correctRefusals)}\n- Fidélité (juge LLM) : ${pct(summary.faithfulness)}\n\n| Question | Mode | Rappel | Citations | Valides | Refus | Fidèle |\n|---|---|---|---|---|---|---|\n` +
    rows.map((r) => `| ${r.q.replace(/\|/g, '/')} | ${r.mode} | ${r.recall === null ? '-' : pct(r.recall)} | ${r.citations} | ${r.validCit} | ${r.refused ? 'oui' : 'non'} | ${r.faithful === null ? '-' : r.faithful ? 'oui' : 'non'} |`).join('\n');
  const dir = path.join(core.dataDir, 'eval');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rapport-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(file, md);
  return { summary, rows, report: file, markdown: md };
}

module.exports = { runEval };
