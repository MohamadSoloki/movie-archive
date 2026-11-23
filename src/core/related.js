'use strict';

// "Related films" = the same series or franchise, found from titles and the owner's folders only (no network).
// Similar films (similar.js) are a different list: same taste, not the same story.
const ROMAN = new Set(['ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix']);
const PART = new Set(['part', 'chapter', 'vol', 'volume', 'episode']);
const MIN_PREFIX = 4; // a shorter name ("Up") only matches an identical name, never a title that merely starts with it

// "Terminator 2: Judgment Day" → "terminator"; "Rocky IV" → "rocky"; "The Terminator" → "terminator"
function franchiseKey(title) {
  let s = String(title || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.split(/\s*[:–—]\s*|\s+-\s+/)[0];
  let words = s.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && (/^\d{1,2}$/.test(words.at(-1)) || ROMAN.has(words.at(-1)) || PART.has(words.at(-1)))) words.pop();
  if (words.length > 1 && /^(the|a|an)$/.test(words[0])) words = words.slice(1);
  return words.join(' ');
}

const stem = (k) => (k.length > 4 && k.endsWith('s') ? k.slice(0, -1) : k);
const isPrefix = (a, b) => b.startsWith(`${a} `);
const folders = (e) => new Set((e.locations || []).map((l) => l.collection).filter(Boolean));
const yearOf = (y) => { const m = /\d{4}/.exec(y || ''); return m ? Number(m[0]) : 9999; };

function sameSeries(a, b) {
  const x = stem(a); const y = stem(b);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_PREFIX && isPrefix(short, long);
}

function relatedTo(base, entries) {
  const key = franchiseKey(base.title);
  const mine = folders(base);
  const out = [];
  for (const e of entries) {
    if (e.key === base.key || e.status !== 'matched' || e.kind !== base.kind) continue;
    const together = [...folders(e)].some((c) => mine.has(c));
    if (together || sameSeries(key, franchiseKey(e.title))) out.push(e);
  }
  return out.sort((a, b) => yearOf(a.year) - yearOf(b.year) || a.title.localeCompare(b.title));
}

// Every film with its related films at once, for a whole archive (the phone list): same answer as relatedTo per film, but
// found through an index of names instead of comparing every pair.
function relatedMap(entries) {
  const films = entries.filter((e) => e.status === 'matched');
  const byName = new Map(); // `${kind}|${stemmed key}` → films
  const byFolder = new Map();
  const add = (m, k, e) => { if (!m.has(k)) m.set(k, []); m.get(k).push(e); };
  const keyOf = new Map();
  for (const e of films) {
    const k = stem(franchiseKey(e.title));
    keyOf.set(e.key, k);
    add(byName, `${e.kind}|${k}`, e);
    for (const c of folders(e)) add(byFolder, `${e.kind}|${c}`, e);
  }
  const links = new Map(); // key → Map(key → film)
  const link = (a, b) => {
    if (a.key === b.key) return;
    if (!links.has(a.key)) links.set(a.key, new Map());
    links.get(a.key).set(b.key, b);
  };
  for (const group of byName.values()) for (const a of group) for (const b of group) link(a, b);
  for (const group of byFolder.values()) for (const a of group) for (const b of group) link(a, b);
  for (const e of films) {
    const words = keyOf.get(e.key).split(' ');
    for (let n = 1; n < words.length; n += 1) { // a shorter name that is the start of this one
      const head = words.slice(0, n).join(' ');
      if (head.length < MIN_PREFIX) continue;
      for (const f of byName.get(`${e.kind}|${head}`) || []) { link(e, f); link(f, e); }
    }
  }
  const out = new Map();
  for (const [k, m] of links) out.set(k, [...m.values()].sort((a, b) => yearOf(a.year) - yearOf(b.year) || a.title.localeCompare(b.title)));
  return out;
}

module.exports = { relatedTo, franchiseKey, relatedMap };
