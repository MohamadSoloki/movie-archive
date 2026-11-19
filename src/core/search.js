'use strict';
const Fuse = require('fuse.js');
const { listEntries } = require('./library.js');

const num = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? null : n; };
// numbers descending, entries without a number last
const byNumberDesc = (get) => (a, b) => {
  const x = get(a); const y = get(b);
  if (x === y) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x;
};
const byName = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
const SORTS = {
  name: byName,
  year: byNumberDesc((e) => num(e.year)),
  rating: byNumberDesc((e) => num(e.rating)),
  added: byNumberDesc((e) => e.addedOrder),
};

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
    query({ query = '', tab = 'all', genres = [], sort = 'name' } = {}) {
      if (!fuse) build();
      const q = query.trim();
      let list = q ? fuse.search(q).map((r) => r.item) : [...all];
      if (tab !== 'all') list = list.filter((e) => e.kind === tab);

      // counts ignore the genre filter, so every chip keeps its number while others are selected
      const counts = new Map();
      for (const e of list) {
        for (const g of e.genreList) {
          const c = counts.get(g.toLowerCase()) || { name: g, count: 0 };
          c.count += 1;
          counts.set(g.toLowerCase(), c);
        }
      }
      const genreCounts = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

      const wanted = genres.map((g) => g.toLowerCase());
      list = list.filter((e) => wanted.every((g) => e.genreList.some((x) => x.toLowerCase() === g)));
      // the second comparison keeps equal entries in alphabetical order
      const cmp = SORTS[sort] || byName;
      list.sort((a, b) => cmp(a, b) || byName(a, b));
      return { entries: list, genres: genreCounts };
    },
    invalidate() { fuse = null; },
  };
}

module.exports = { createSearch };
