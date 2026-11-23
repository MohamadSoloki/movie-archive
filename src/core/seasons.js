'use strict';
const nodeFs = require('node:fs');
const path = require('node:path');
const { episodeRefs } = require('./gaps.js');
const { normalizeFa } = require('./persian.js');

const MAX_EPISODE = 999;

// every file under a season folder, as paths relative to it with `/` (episodes may sit in subfolders)
function filesUnder(fsApi, dir, rel = '', depth = 3) {
  let list;
  try { list = fsApi.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return null; }
  const out = [];
  for (const d of list) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isFile()) out.push(r);
    else if (d.isDirectory() && depth > 0) out.push(...(filesUnder(fsApi, dir, r, depth - 1) ?? []));
  }
  return out;
}

// The episode numbers a season folder holds, read from file names; null when the folder cannot be read or no name carries a number
// (then only the whole season can be chosen).
function episodesIn(dir, fsApi = nodeFs) {
  const files = filesUnder(fsApi, dir);
  if (!files) return null;
  const eps = [...new Set(files.flatMap((f) => episodeRefs(f).map((r) => r.ep)))].sort((a, b) => a - b);
  return eps.length ? eps : null;
}

// "1-5, 7 9" -> [1,2,3,4,5,7,9]. Persian digits and "،" work; numbers outside 1..999 and junk are dropped.
function parseEpisodes(text) {
  const out = new Set();
  for (const part of normalizeFa(String(text ?? '')).split(/[,،\s]+/)) {
    const m = /^(\d{1,4})(?:[-–](\d{1,4}))?$/.exec(part);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] === undefined ? a : Number(m[2]);
    if (a > b) [a, b] = [b, a];
    for (let n = Math.max(a, 1); n <= Math.min(b, MAX_EPISODE); n += 1) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

// A file belongs to an episode when its path (inside the season folder) names one of the wanted numbers: the subtitle of an episode goes with it.
function episodeFilter(wanted) {
  const set = new Set(wanted);
  return (rel) => episodeRefs(rel).some((r) => set.has(r.ep));
}

module.exports = { episodesIn, parseEpisodes, episodeFilter, filesUnder };
