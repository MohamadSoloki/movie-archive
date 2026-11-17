'use strict';

const JUNK = new Set(['1080p', '720p', '2160p', '4k', 'bluray', 'brrip', 'webrip', 'web', 'dl',
  'hdtv', 'dvdrip', 'x264', 'x265', 'h264', 'h265', 'hevc']);
const SEP = /[._\-]+/g;
const TOKENS = {
  '{title}': '(?<title>.+)',
  '{year}': '(?<year>(?:18|19|20)\\d{2})(?!\\d)',
  '{season}': '(?<season>\\d{1,2})(?!\\d)',
  '*': '.*',
};

const squash = (s) => s.replace(SEP, ' ').replace(/\s+/g, ' ');
const norm = (s) => squash(s).trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (s) => s.replace(/^[\s(\[]+|[\s)\]]+$/g, '');

function compile(pattern) {
  const src = pattern.trim().split(/(\{title\}|\{year\}|\{season\}|\*)/)
    .map((p) => (Object.hasOwn(TOKENS, p) ? TOKENS[p] : esc(squash(p))))
    .join('');
  return new RegExp(`^${src}$`, 'iu');
}

function auto(n, validYear) {
  const years = [...n.matchAll(/(?<!\d)(?:18|19|20)\d{2}(?!\d)/g)].filter((m) => validYear(+m[0]));
  const last = years.at(-1);
  if (last) {
    const t = clean(n.slice(0, last.index));
    if (t) return { title: t, year: last[0] };
  }
  const words = n.split(' ');
  const cut = words.findIndex((w) => JUNK.has(w.toLowerCase()));
  const t = clean(cut > 0 ? words.slice(0, cut).join(' ') : n);
  return { title: t || n, year: null };
}

function parseFolderName(name, patterns, now = new Date()) {
  const n = norm(name);
  const max = now.getFullYear() + 1;
  const validYear = (y) => y >= 1888 && y <= max;
  for (const p of patterns) {
    const g = compile(p).exec(n)?.groups;
    if (!g || (g.year && !validYear(+g.year))) continue;
    return { title: clean(g.title ?? n), year: g.year ?? null, season: g.season ?? null, by: 'pattern' };
  }
  return { ...auto(n, validYear), season: null, by: 'auto' };
}

module.exports = { parseFolderName };
