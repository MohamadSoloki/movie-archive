'use strict';
const crypto = require('node:crypto');
const { ProviderError } = require('./errors.js');

const BASE = 'https://api.mymemory.translated.net/get';
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /[A-Za-z]/;
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

// MyMemory takes at most 500 bytes of text per request, so long plots go in pieces.
function splitForTranslation(text, max = 450) {
  const pieces = [];
  for (const sentence of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?]) /)) {
    if (!sentence) continue;
    if (sentence.length <= max) { pieces.push(sentence); continue; }
    let cur = '';
    for (let word of sentence.split(' ')) {
      while (word.length > max) { // a word longer than the limit is cut, never dropped
        if (cur) { pieces.push(cur); cur = ''; }
        pieces.push(word.slice(0, max));
        word = word.slice(max);
      }
      if (cur && cur.length + 1 + word.length > max) { pieces.push(cur); cur = ''; }
      cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) pieces.push(cur);
  }
  // sentences share a chunk while they fit
  const chunks = [];
  for (const p of pieces) {
    if (chunks.length && chunks[chunks.length - 1].length + 1 + p.length <= max) chunks[chunks.length - 1] += ` ${p}`;
    else chunks.push(p);
  }
  return chunks;
}

function createTranslator({ fetch = globalThis.fetch, email = '' } = {}) {
  return {
    async translate(text) {
      const url = new URL(BASE);
      url.searchParams.set('q', text);
      url.searchParams.set('langpair', 'en|fa');
      if (email) url.searchParams.set('de', email);
      let res;
      let body = null;
      try {
        res = await fetch(url);
      } catch (e) {
        throw new ProviderError('network', e.message);
      }
      if (res.status === 429) throw new ProviderError('quota'); // before reading the body: it may not be JSON
      try {
        body = await res.json();
      } catch (e) {
        throw new ProviderError('network', e.message);
      }
      const out = String(body?.responseData?.translatedText ?? '');
      // the quota notice comes back as a "translation", so it is recognised by its wording too
      if (body?.quotaFinished === true || Number(body?.responseStatus) === 429 || /^\s*MYMEMORY WARNING/i.test(out)) {
        throw new ProviderError('quota');
      }
      if (Number(body?.responseStatus) !== 200) throw new ProviderError('network', `status ${body?.responseStatus}`);
      return out.replace(/&(?:amp|quot|#39|lt|gt);/g, (m) => ENTITIES[m]);
    },
  };
}

async function translateCached(db, translator, text) {
  if (ARABIC.test(text) && !LATIN.test(text)) return text;
  const out = [];
  for (const chunk of splitForTranslation(text)) {
    const hash = crypto.createHash('sha1').update(chunk).digest('hex');
    let row = db.prepare('SELECT text FROM translations WHERE hash = ?').get(hash);
    if (!row) {
      row = { text: await translator.translate(chunk) };
      db.prepare('INSERT OR REPLACE INTO translations(hash, text) VALUES(?, ?)').run(hash, row.text);
    }
    out.push(row.text);
  }
  return out.join(' ');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Translates the stored plots nobody has opened yet, newest first, so opening a film later shows the Persian text at once.
// Stops by itself when the free quota is used up (or the network fails) and picks up from there the next time.
async function pretranslate(db, translator, { pause = 700, onProgress, signal } = {}) {
  const missing = (plot) => !(ARABIC.test(plot) && !LATIN.test(plot)) && splitForTranslation(plot).some((chunk) => {
    const hash = crypto.createHash('sha1').update(chunk).digest('hex');
    return !db.prepare('SELECT 1 FROM translations WHERE hash = ?').get(hash);
  });
  const todo = db.prepare("SELECT plot FROM titles WHERE plot IS NOT NULL AND plot != '' ORDER BY id DESC").all().map((r) => r.plot).filter(missing);
  const r = { translated: 0, remaining: todo.length, stoppedBy: null };
  for (const plot of todo) {
    if (signal?.aborted) { r.stoppedBy = 'cancelled'; break; }
    try {
      await translateCached(db, translator, plot);
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      r.stoppedBy = e.kind;
      break;
    }
    r.translated += 1;
    r.remaining -= 1;
    onProgress?.({ done: r.translated, total: todo.length });
    if (pause && r.remaining) await sleep(pause);
  }
  return r;
}

module.exports = { splitForTranslation, createTranslator, translateCached, pretranslate };
