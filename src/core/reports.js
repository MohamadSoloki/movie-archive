'use strict';
const { badgesOf, compareTitles } = require('./library.js');
const { qualityOf } = require('./quality.js');

// The archive as a printable list: every film once, under its first genre (no genre last), names in order.
function catalogByGenre(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (e.kind === 'collection') continue;
    const genre = e.genreList[0] ?? null;
    if (!groups.has(genre)) groups.set(genre, []);
    groups.get(genre).push({ title: e.title, year: e.year, kind: e.kind, badges: badgesOf(e.quality) });
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null) - (b === null) || String(a).localeCompare(String(b)))
    .map(([genre, items]) => ({ genre, items: items.sort(compareTitles) }));
}

// Films (and seasons of a series) kept in two or more folders, with every copy, its size and quality, so the owner can choose what to delete by hand.
// `sizeOf(location)` gives bytes, or null when unknown (drive unplugged, unreadable). Reclaimable space = all known sizes minus the biggest copy.
// A folder marked missing is not a copy. Nothing is deleted here.
function duplicates(entries, sizeOf) {
  const groups = [];
  for (const e of entries) {
    if (e.kind === 'collection') continue;
    const bySeason = new Map();
    for (const l of e.locations) {
      if (l.missing) continue;
      const k = l.season == null ? '' : String(l.season);
      if (!bySeason.has(k)) bySeason.set(k, []);
      bySeason.get(k).push(l);
    }
    for (const [season, locs] of bySeason) {
      if (locs.length < 2) continue;
      const copies = locs.map((l) => {
        const q = qualityOf(l.relPath);
        return { locationId: l.id, driveLabel: l.driveLabel, online: l.online, relPath: l.relPath, bytes: sizeOf(l),
          badges: [q.res, q.dub ? 'dub' : null, q.hardsub ? 'hardsub' : q.sub ? 'sub' : null].filter(Boolean) };
      }).sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1) || a.relPath.localeCompare(b.relPath));
      const known = copies.map((c) => c.bytes).filter((b) => b != null);
      const reclaim = known.length ? known.reduce((a, b) => a + b, 0) - Math.max(...known) : 0;
      groups.push({ key: e.key, title: e.title, year: e.year, kind: e.kind, season: season === '' ? null : Number(season), copies, reclaim });
    }
  }
  groups.sort((a, b) => b.reclaim - a.reclaim || compareTitles(a, b) || (a.season ?? 0) - (b.season ?? 0));
  return { groups, reclaim: groups.reduce((n, g) => n + g.reclaim, 0), count: groups.length };
}

module.exports = { catalogByGenre, duplicates };
