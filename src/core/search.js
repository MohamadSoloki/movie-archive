'use strict';
const Fuse = require('fuse.js');
const { listEntries, compareTitles: byName } = require('./library.js');

const num = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? null : n; };
// numbers descending, entries without a number last
const byNumberDesc = (get) => (a, b) => {
  const x = get(a); const y = get(b);
  if (x === y) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x;
};
const SORTS = {
  name: byName,
  year: byNumberDesc((e) => num(e.year)),
  rating: byNumberDesc((e) => num(e.rating)),
  added: byNumberDesc((e) => e.addedOrder),
};

function createSearch(db) {
  let all = null;
  let byKey = null;
  let fuse = null;
  const build = () => {
    all = listEntries(db);
    byKey = new Map(all.map((e) => [e.key, e]));
    fuse = null;
  };
  // the fuzzy index is only built when somebody types something
  const fuzzy = () => {
    fuse ??= new Fuse(all, {
      keys: [{ name: 'title', weight: 3 }, { name: 'locations.folderName', weight: 2 },
        { name: 'genres', weight: 1 }, { name: 'actors', weight: 1 }],
      threshold: 0.35,
      ignoreLocation: true,
    });
    return fuse;
  };
  return {
    query({ query = '', tab = 'all', genres = [], attention = [], sort = 'name' } = {}) {
      if (!all) build();
      const q = query.trim();
      let list = q ? fuzzy().search(q).map((r) => r.item) : [...all];
      if (tab !== 'all') list = list.filter((e) => e.kind === tab);

      const wanted = genres.map((g) => g.toLowerCase());
      const hasGenres = (e) => wanted.every((g) => e.genreList.some((x) => x.toLowerCase() === g));
      const hasAttention = (e) => !attention.length || attention.includes(e.attention);

      // each group of counts ignores its own filter, so a chip keeps its number while others of its group are selected
      const attentionCounts = { ok: 0, guess: 0, problem: 0 };
      for (const e of list) if (hasGenres(e)) attentionCounts[e.attention] += 1;
      const counts = new Map();
      for (const e of list.filter(hasAttention)) {
        for (const g of e.genreList) {
          const c = counts.get(g.toLowerCase()) || { name: g, count: 0 };
          c.count += 1;
          counts.set(g.toLowerCase(), c);
        }
      }
      const genreCounts = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

      list = list.filter((e) => hasGenres(e) && hasAttention(e));
      // the second comparison keeps equal entries in alphabetical order
      const cmp = SORTS[sort] || byName;
      list.sort((a, b) => cmp(a, b) || byName(a, b));
      return { entries: list, genres: genreCounts, attentionCounts };
    },
    find(key) {
      if (!all) build();
      return byKey.get(key) ?? null;
    },
    invalidate() { all = null; byKey = null; fuse = null; },
  };
}

module.exports = { createSearch };
