'use strict';
// Découpage par titres Markdown puis par taille, avec chevauchement et chemin de titres.

const approxTokens = (s) => Math.ceil(s.length / 4);

function splitSections(body, bodyStart, title) {
  const lines = body.split('\n');
  const sections = [];
  let stack = [];
  let cur = { heading: [title], start: 0, text: '' };
  let pos = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      if (cur.text.trim()) sections.push(cur);
      const level = h[1].length;
      stack = stack.filter((s) => s.level < level);
      stack.push({ level, text: h[2].trim() });
      cur = { heading: [title, ...stack.map((s) => s.text)], start: pos, text: line + '\n' };
    } else {
      cur.text += line + '\n';
    }
    pos += line.length + 1;
  }
  if (cur.text.trim()) sections.push(cur);
  return sections.map((s) => ({ ...s, start: s.start + bodyStart }));
}

function splitLong(text, maxChars, overlapChars) {
  if (text.length <= maxChars) return [{ text, offset: 0 }];
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxChars, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      const sent = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('\n', end));
      if (para > i + maxChars * 0.5) end = para + 2;
      else if (sent > i + maxChars * 0.5) end = sent + 1;
    }
    out.push({ text: text.slice(i, end), offset: i });
    if (end >= text.length) break;
    i = Math.max(end - overlapChars, i + 1);
  }
  return out;
}

/**
 * @returns {{order:number, headingPath:string, text:string, offset:number, tokens:number}[]}
 */
function chunkNote(note, opts = {}) {
  const targetTokens = opts.targetTokens || 650;
  const overlap = opts.overlap ?? 0.12;
  const maxChars = targetTokens * 4;
  const overlapChars = Math.floor(maxChars * overlap);
  const chunks = [];
  let order = 0;
  for (const sec of splitSections(note.body, note.bodyStart, note.title)) {
    const body = sec.text.replace(/\s+$/, '');
    if (body.replace(/^#+\s.*$/m, '').trim().length < 1 && !body.trim()) continue;
    for (const part of splitLong(body, maxChars, overlapChars)) {
      const text = part.text.trim();
      if (text.length < 3) continue;
      chunks.push({
        order: order++,
        headingPath: sec.heading.join(' > '),
        text,
        offset: sec.start + part.offset,
        tokens: approxTokens(text),
      });
    }
  }
  return chunks;
}

/** Fusionne les très petits chunks consécutifs d'une même note pour limiter les appels LLM. */
function mergeTiny(chunks, minTokens = 60) {
  const out = [];
  for (const c of chunks) {
    const prev = out[out.length - 1];
    if (prev && (prev.tokens < minTokens || c.tokens < minTokens) && prev.tokens + c.tokens < 700) {
      prev.text += '\n\n' + c.text;
      prev.tokens = approxTokens(prev.text);
      if (c.headingPath !== prev.headingPath && c.headingPath.length < prev.headingPath.length) prev.headingPath = c.headingPath;
    } else out.push({ ...c });
  }
  return out.map((c, i) => ({ ...c, order: i }));
}

module.exports = { chunkNote, mergeTiny, approxTokens };
