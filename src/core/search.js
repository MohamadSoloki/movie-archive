'use strict';
const Fuse = require('fuse.js');
const { listEntries } = require('./library.js');

function createSearch(db) {
  let all = null;
  let fuse = null;
  const build = () => {
    all = listEntries(db);
    fuse = new Fuse(all, {
      keys: [{ name: 'title', weight: 3 }, { name: 'locations.folderName', weight: 2 },
        { name: 'genres', weight: 1 }, { name: 'actors', weight: 1 }],
      threshold: 0.35,
      ignoreLocation: true,
    });
  };
  return {
    query(q) {
      if (!fuse) build();
      const s = q.trim();
      return s ? fuse.search(s).map((r) => r.item) : [...all];
    },
    invalidate() { fuse = null; },
  };
}

module.exports = { createSearch };
