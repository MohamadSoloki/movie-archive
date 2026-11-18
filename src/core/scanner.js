'use strict';
const nodeFs = require('node:fs');
const path = require('node:path');

const DEFAULT_IGNORE = ['$recycle.bin', 'system volume information', 'subtitles', 'subs', 'extras', 'sample', 'specials'];
const DISC = /^(cd|disc|disk)[\s._-]?\d+$/i;
const VIDEO = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'ts', 'm2ts', 'mpg', 'mpeg', 'flv', 'webm', 'iso', 'vob']);
// "S01", "Season 1", "فصل 1"; a letter or digit after the number rules out names like S1mone
const SEASON = /(?:^|[\s._-])(?:s|season[\s._-]?|فصل[\s._-]?)(\d{1,2})(?![A-Za-z\d])/iu;
const joinRel = (a, b) => (a ? `${a}/${b}` : b);
const hasYear = (name) => /(?<!\d)(?:18|19|20)\d{2}(?!\d)/.test(name);

function seasonOf(name) {
  const m = SEASON.exec(name);
  return m ? { n: m[1], prefix: name.slice(0, m.index).replace(/[\s._-]+$/, '').trim() } : null;
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
function scanFolder(absPath, relPath, { ignore = [], collections = [], fsApi = nodeFs, maxDepth = 8 } = {}) {
  const skip = new Set([...DEFAULT_IGNORE, ...ignore.map((s) => s.toLowerCase())]);
  const skipped = (name) => skip.has(name.toLowerCase()) || DISC.test(name);
  const top = list(fsApi, absPath);
  if (!top) return { ok: false, entries: [], unreadable: [] };

  const entries = [];
  // folders that exist but could not be read: the sync must not call them missing
  const unreadable = [];

  function walk(abs, rel, name, parentName, depth) {
    const ls = list(fsApi, abs);
    if (!ls) { unreadable.push(rel); return; }
    const isEmpty = ls.length === 0;

    const season = seasonOf(name);
    if (season) {
      entries.push({ name, relPath: rel, isEmpty, season: season.n, titleName: season.prefix || parentName || name });
      return;
    }
    const dirs = ls.filter((d) => d.isDirectory() && !skipped(d.name)).map((d) => d.name);
    const hasVideo = ls.some((d) => d.isFile() && VIDEO.has(d.name.split('.').pop().toLowerCase()));
    const opens = dirs.some((n) => seasonOf(n)) || collections.includes(rel)
      || (dirs.length > 0 && !hasVideo && !hasYear(name));
    if (opens && depth < maxDepth) {
      for (const sub of dirs) walk(path.join(abs, sub), joinRel(rel, sub), sub, name, depth + 1);
      return;
    }
    entries.push({ name, relPath: rel, isEmpty, season: null, titleName: name });
  }

  const rootName = path.basename(absPath);
  for (const d of top) {
    if (d.isDirectory() && !skipped(d.name)) walk(path.join(absPath, d.name), joinRel(relPath, d.name), d.name, rootName, 1);
  }
  return { ok: true, entries, unreadable };
}

module.exports = { scanFolder };
