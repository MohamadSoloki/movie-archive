'use strict';
const nodeFs = require('node:fs');
const path = require('node:path');
const { VIDEO } = require('./scanner.js');
const { normalizeFa } = require('./persian.js');

// Episode numbers a file name claims: S01E05, S01E01E02, S01E01-E03, 1x05, E05, Episode 5, قسمت 5.
function episodeRefs(name) {
  const n = normalizeFa(name);
  const out = [];
  const add = (season, ep) => { if (!out.some((r) => r.season === season && r.ep === ep)) out.push({ season, ep }); };
  let m = /s(\d{1,2})[\s._-]?e(\d{1,3})((?:[\s._-]?-?[\s._-]?e\d{1,3})*)(?:-(\d{1,3}))?/.exec(n);
  if (m) {
    const season = Number(m[1]);
    const first = Number(m[2]);
    add(season, first);
    const more = [...m[3].matchAll(/e(\d{1,3})/g)].map((x) => Number(x[1]));
    // S01E01-E03 is a range, S01E01E02 is a list
    if (more.length && /-\s*e/.test(m[3])) for (let i = first + 1; i <= more[more.length - 1]; i += 1) add(season, i);
    else more.forEach((e) => add(season, e));
    return out;
  }
  m = /(?<![\d])(\d{1,2})x(\d{2,3})(?!\d)/.exec(n);
  if (m) return [{ season: Number(m[1]), ep: Number(m[2]) }];
  m = /(?:^|[^a-z\d])(?:e|ep|episode|قسمت)[\s._-]?(\d{1,3})(?!\d)/.exec(n);
  if (m) return [{ season: null, ep: Number(m[1]) }];
  return [];
}

// every video file under a folder (a season folder may keep its episodes in a subfolder)
function videoFiles(fsApi, dir, depth = 2) {
  let list;
  try { list = fsApi.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const out = [];
  for (const d of list) {
    if (d.isFile() && VIDEO.has(d.name.split('.').pop().toLowerCase())) out.push(d.name);
    else if (d.isDirectory() && depth > 0) out.push(...(videoFiles(fsApi, path.join(dir, d.name), depth - 1) ?? []));
  }
  return out;
}

/**
 * Seasons whose folder lacks episodes that OMDb/Jikan say have aired. Only folders on drives that are plugged in are opened,
 * and only episode numbers read from file names count; a folder where no name carries a number is "unreadable", not incomplete.
 */
function seriesGaps(db, { fsApi = nodeFs, today = new Date().toISOString().slice(0, 10) } = {}) {
  const rows = db.prepare(`SELECT l.id, l.rel_path, l.season, l.title_id, t.title, d.root, d.online
    FROM locations l JOIN titles t ON t.id = l.title_id LEFT JOIN drives d ON d.serial = l.drive_serial
    WHERE l.missing = 0 AND (t.type = 'series' OR t.source = 'jikan') ORDER BY t.title, l.id`).all();
  const expectedOf = db.prepare('SELECT season, number, released FROM episodes WHERE title_id = ? ORDER BY season, number');
  const byTitle = new Map();
  let checked = 0; let offline = 0; let unreadable = 0;
  for (const l of rows) {
    if (!l.online || !l.root) { offline += 1; continue; }
    const files = videoFiles(fsApi, path.join(l.root, l.rel_path));
    if (!files) { offline += 1; continue; }
    const refs = files.flatMap(episodeRefs);
    if (!refs.length) { unreadable += 1; continue; }
    const aired = (e) => e.released && e.released <= today;
    const all = expectedOf.all(l.title_id).filter(aired);
    // a season folder owns its season; a whole-show folder spreads over the seasons its file names name
    const seasons = l.season ? [Number(l.season)] : [...new Set(refs.map((r) => r.season).filter((s) => s != null))];
    checked += 1;
    for (const season of seasons) {
      const expected = all.filter((e) => e.season === season).map((e) => e.number);
      if (!expected.length) continue;
      const have = new Set(refs.filter((r) => r.season === season || (r.season == null && l.season)).map((r) => r.ep));
      const missing = expected.filter((n) => !have.has(n));
      if (!missing.length) continue;
      if (!byTitle.has(l.title_id)) byTitle.set(l.title_id, { titleId: l.title_id, title: l.title, seasons: [] });
      byTitle.get(l.title_id).seasons.push({ season, have: expected.length - missing.length, expected: expected.length, missing, locationId: l.id });
    }
  }
  return { entries: [...byTitle.values()], checked, offline, unreadable };
}

module.exports = { episodeRefs, seriesGaps };
