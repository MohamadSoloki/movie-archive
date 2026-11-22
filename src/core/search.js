'use strict';
const Fuse = require('fuse.js');
const { normalizeFa } = require('./persian.js');
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
// quality filter flags; a chosen set must ALL hold
const QUALITY = {
  dub: (q) => q.dub, sub: (q) => q.sub, hardsub: (q) => q.hardsub,
  hd: (q) => q.res === '1080p' || q.res === '4K', '4k': (q) => q.res === '4K',
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
    // searched text is normalised (ي/ی, digits, half-space...) in a side copy, so the entries themselves stay as they are
    const norm = (list) => list.map((x) => normalizeFa(x));
    fuse ??= new Fuse(all.map((e) => ({
      e, title: normalizeFa(e.title), folders: norm(e.locations.map((l) => l.folderName)), aliases: norm(e.aliases),
      tags: norm(e.userTags), countries: norm(e.countryList), genres: normalizeFa(e.genres), actors: normalizeFa(e.actors),
    })), {
      keys: [{ name: 'title', weight: 3 }, { name: 'aliases', weight: 3 }, { name: 'folders', weight: 2 },
        { name: 'tags', weight: 2 }, { name: 'countries', weight: 1 }, { name: 'genres', weight: 1 }, { name: 'actors', weight: 1 }],
      threshold: 0.35,
      ignoreLocation: true,
    });
    return fuse;
  };
  return {
    query({ query = '', tab = 'all', genres = [], tags = [], countries = [], attention = [], quality = [], sort = 'name' } = {}) {
      if (!all) build();
      const q = query.trim();
      let list = q ? fuzzy().search(normalizeFa(q)).map((r) => r.item.e) : [...all];
      if (tab !== 'all') list = list.filter((e) => e.kind === tab);

      const wanted = genres.map((g) => g.toLowerCase());
      const hasGenres = (e) => wanted.every((g) => e.genreList.some((x) => x.toLowerCase() === g));
      const wantedTags = tags.map((g) => g.toLowerCase());
      const hasTags = (e) => wantedTags.every((g) => e.userTags.some((x) => x.toLowerCase() === g));
      const wantedCountries = countries.map((g) => g.toLowerCase());
      // a film made in several countries matches when it is from ANY chosen one
      const hasCountries = (e) => !wantedCountries.length || e.countryList.some((x) => wantedCountries.includes(x.toLowerCase()));
      const hasAttention = (e) => !attention.length || attention.includes(e.attention);
      const hasQuality = (e) => quality.every((f) => QUALITY[f]?.(e.quality));
      const qualityCounts = Object.fromEntries(Object.keys(QUALITY).map((f) => [f, 0]));

      // each group of counts ignores its own filter, so a chip keeps its number while others of its group are selected
      const attentionCounts = { ok: 0, guess: 0, problem: 0 };
      for (const e of list) if (hasGenres(e) && hasTags(e) && hasCountries(e) && hasQuality(e)) attentionCounts[e.attention] += 1;
      for (const e of list) {
        if (!(hasGenres(e) && hasTags(e) && hasCountries(e) && hasAttention(e))) continue;
        for (const f of Object.keys(QUALITY)) if (QUALITY[f](e.quality)) qualityCounts[f] += 1;
      }
      const countOf = (pick, keep) => {
        const counts = new Map();
        for (const e of list.filter(keep)) {
          for (const g of pick(e)) {
            const c = counts.get(g.toLowerCase()) || { name: g, count: 0 };
            c.count += 1;
            counts.set(g.toLowerCase(), c);
          }
        }
        return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      };
      const genreCounts = countOf((e) => e.genreList, (e) => hasAttention(e) && hasTags(e) && hasCountries(e) && hasQuality(e));
      const tagCounts = countOf((e) => e.userTags, (e) => hasAttention(e) && hasGenres(e) && hasCountries(e) && hasQuality(e));
      const countryCounts = countOf((e) => e.countryList, (e) => hasAttention(e) && hasGenres(e) && hasTags(e) && hasQuality(e));

      list = list.filter((e) => hasGenres(e) && hasTags(e) && hasCountries(e) && hasAttention(e) && hasQuality(e));
      // the second comparison keeps equal entries in alphabetical order
      const cmp = SORTS[sort] || byName;
      list.sort((a, b) => cmp(a, b) || byName(a, b));
      return { entries: list, genres: genreCounts, tagCounts, countryCounts, attentionCounts, qualityCounts };
    },
    // every manual tag with the number of entries that carry it, for suggestions
    tagList() {
      if (!all) build();
      const counts = new Map();
      for (const e of all) {
        for (const g of e.userTags) {
          const c = counts.get(g.toLowerCase()) || { name: g, count: 0 };
          c.count += 1;
          counts.set(g.toLowerCase(), c);
        }
      }
      return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    },
    find(key) {
      if (!all) build();
      return byKey.get(key) ?? null;
    },
    invalidate() { all = null; byKey = null; fuse = null; },
  };
}

module.exports = { createSearch };
