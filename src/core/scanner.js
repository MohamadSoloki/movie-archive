'use strict';
const nodeFs = require('node:fs');
const path = require('node:path');

const DEFAULT_IGNORE = ['$recycle.bin', 'system volume information', 'subtitles', 'subs', 'extras', 'sample', 'specials'];
const DISC = /^(cd|disc|disk)[\s._-]?\d+$/i;
const VIDEO = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'ts', 'm2ts', 'mpg', 'mpeg', 'flv', 'webm', 'iso', 'vob']);
// "S01", "Season 1", "فصل 1"; a letter or digit after the number rules out names like S1mone
const SEASON = /(?:^|[\s._-])(?:s|seasons?[\s._-]?|فصل[\s._-]?)(\d{1,2})(?![A-Za-z\d])/iu;
// "S01-S10", "Seasons 1-5": one folder holding many seasons
const RANGE = /^\s*[-–~]\s*(?:s|seasons?[\s._-]?)?\d/iu;
const joinRel = (a, b) => (a ? `${a}/${b}` : b);
const YEAR = /(?<!\d)((?:18|19|20)\d{2})(?!\d)/;
const hasYear = (name) => YEAR.test(name);
// files that are not a movie of their own: samples, trailers, episodes, disc parts
const NOT_A_MOVIE = /(?:^|[\s._()[\]-])(?:sample|trailer|extras?|featurette|(?:cd|disc|disk|part|pt)[\s._-]?\d+)(?![A-Za-z\d])|s\d{1,2}[\s._-]?e\d{1,3}|\b\d{1,2}x\d{2}\b/i;
const isVideo = (d) => d.isFile() && VIDEO.has(d.name.split('.').pop().toLowerCase());
const stem = (file) => file.slice(0, file.lastIndexOf('.'));

function seasonOf(name) {
  const m = SEASON.exec(name);
  if (!m) return null;
  const prefix = name.slice(0, m.index).replace(/[\s._-]+$/, '').trim();
  return { n: m[1], prefix, range: RANGE.test(name.slice(m.index + m[0].length)) };
}

// Directory entries, or null when the directory cannot be read.
function list(fsApi, dir) {
  try {
    return fsApi.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/**
 * Walks the folders under absPath and returns one entry per title folder or season folder.
 * A season folder is never opened. A folder is opened (and is no entry itself) when it holds season
 * folders, is listed in `collections`, or holds only subfolders with no year in its name.
 */
function scanFolder(absPath, relPath, { ignore = [], collections = [], fsApi = nodeFs, maxDepth = 8, only = null } = {}) {
  const skip = new Set([...DEFAULT_IGNORE, ...ignore.map((s) => s.toLowerCase())]);
  const skipped = (name) => skip.has(name.toLowerCase()) || DISC.test(name);
  const top = list(fsApi, absPath);
  if (!top) return { ok: false, entries: [], unreadable: [] };

  const entries = [];
  // folders that exist but could not be read: the sync must not call them missing
  const unreadable = [];

  // collection: the folder that groups the titles around this one, or null
  function walk(abs, rel, name, parentName, depth, collection = null) {
    const ls = list(fsApi, abs);
    if (!ls) { unreadable.push(rel); return; }
    const isEmpty = ls.length === 0;

    const parsed = seasonOf(name);
    const season = parsed && !parsed.range ? parsed : null;
    const shown = parsed?.range ? parsed.prefix || parentName || name : name; // clean show name for a multi-season folder
    if (season) {
      entries.push({ name, relPath: rel, isEmpty, season: season.n, titleName: season.prefix || parentName || name, collection });
      return;
    }
    const dirs = ls.filter((d) => d.isDirectory() && !skipped(d.name)).map((d) => d.name);
    const hasVideo = ls.some(isVideo);
    const seasonChild = dirs.some((n) => seasonOf(n) && !seasonOf(n).range);
    // several separate movie files: a year-less folder name, or different years in the file names
    const films = ls.filter((d) => isVideo(d) && !NOT_A_MOVIE.test(d.name)).map((d) => d.name);
    const years = new Set(films.map((f) => YEAR.exec(f)?.[1]).filter(Boolean));
    const split = !seasonChild && films.length >= 2 && (!hasYear(name) || years.size >= 2);
    const opens = seasonChild || split || collections.includes(rel)
      || (!hasVideo && dirs.filter(hasYear).length >= 2)
      || (dirs.length > 0 && !hasVideo && !hasYear(name));
    if (opens && depth < maxDepth) {
      // a series folder is not a collection: its seasons stay members of the collection around it
      const inner = seasonChild ? collection : rel;
      if (split) {
        for (const f of films) entries.push({ name: stem(f), relPath: joinRel(rel, f), isEmpty: false, season: null, titleName: stem(f), collection: inner });
      }
      for (const sub of dirs) walk(path.join(abs, sub), joinRel(rel, sub), sub, shown, depth + 1, inner);
      return;
    }
    entries.push({ name, relPath: rel, isEmpty, season: null, titleName: shown, collection });
  }

  const rootName = path.basename(absPath);
  for (const d of top) {
    if (only && d.name.toLowerCase() !== only.toLowerCase()) continue; // single-folder root
    if (d.isDirectory() && !skipped(d.name)) walk(path.join(absPath, d.name), joinRel(relPath, d.name), d.name, rootName, 1, null);
  }
  return { ok: true, entries, unreadable };
}

module.exports = { scanFolder, VIDEO };
