'use strict';
const nodeFs = require('node:fs');
const path = require('node:path');

const DEFAULT_IGNORE = ['$recycle.bin', 'system volume information', 'subtitles', 'subs', 'extras', 'sample'];
const joinRel = (a, b) => (a ? `${a}/${b}` : b);

// Names of child directories, or null when the directory cannot be read.
function subdirs(fsApi, dir) {
  try {
    return fsApi.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
}

function scanFolder(absPath, relPath, { ignore = [], collections = [], fsApi = nodeFs } = {}) {
  const skip = new Set([...DEFAULT_IGNORE, ...ignore.map((s) => s.toLowerCase())]);
  const top = subdirs(fsApi, absPath);
  if (!top) return { ok: false, entries: [] };

  const entries = [];
  const add = (abs, rel, name) => {
    try {
      entries.push({ name, relPath: rel, isEmpty: fsApi.readdirSync(abs).length === 0 });
    } catch {
      // unreadable folder: skip it, keep scanning
    }
  };
  for (const name of top) {
    if (skip.has(name.toLowerCase())) continue;
    const rel = joinRel(relPath, name);
    const abs = path.join(absPath, name);
    if (collections.includes(rel)) {
      for (const sub of subdirs(fsApi, abs) || []) {
        if (!skip.has(sub.toLowerCase())) add(path.join(abs, sub), joinRel(rel, sub), sub);
      }
    } else {
      add(abs, rel, name);
    }
  }
  return { ok: true, entries };
}

module.exports = { scanFolder };
