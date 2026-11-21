'use strict';

// one shared collator: building it per comparison is what made sorting thousands of titles slow
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
const compareTitles = (a, b) => collator.compare(a.title, b.title);

function listEntries(db) {
  const locs = db.prepare(`SELECT l.*, d.label AS drive_label, COALESCE(d.online, 0) AS drive_online
    FROM locations l LEFT JOIN drives d ON d.serial = l.drive_serial ORDER BY l.id`).all();
  const titles = new Map(db.prepare('SELECT * FROM titles').all().map((t) => [t.id, t]));
  const tagsByLoc = new Map();
  for (const r of db.prepare('SELECT location_id, tag FROM tags').all()) {
    if (!tagsByLoc.has(r.location_id)) tagsByLoc.set(r.location_id, []);
    tagsByLoc.get(r.location_id).push(r.tag);
  }
  const shape = (l) => ({
    id: l.id, driveSerial: l.drive_serial, driveLabel: l.drive_label || '', online: !!l.drive_online,
    relPath: l.rel_path, folderName: l.folder_name, season: l.season, isEmpty: !!l.is_empty, missing: !!l.missing,
    collection: l.collection,
  });

  const kindOf = (type) => (type === 'movie' || type === 'series' ? type : 'other');
  const entries = [];
  const byTitle = new Map();
  for (const l of locs) {
    const t = l.title_id != null ? titles.get(l.title_id) : null;
    if (!t) {
      entries.push({
        key: `l:${l.id}`, titleId: null, locationId: l.id, title: l.parsed_title || l.folder_name, year: l.parsed_year,
        type: null, plot: null, genres: null, rating: null, runtime: null, actors: null, posterFile: null,
        status: l.status, guessed: !!l.guessed, locations: [shape(l)],
        imdbId: null, genreList: [], director: null, awards: null, rated: null, country: null, countryList: [], totalSeasons: null,
        kind: l.season ? 'series' : 'movie', addedOrder: l.id, userTags: [],
      });
      continue;
    }
    let e = byTitle.get(t.id);
    if (!e) {
      e = {
        key: `t:${t.id}`, titleId: t.id, locationId: null, title: t.title, year: t.year, type: t.type, plot: t.plot,
        genres: t.genres, rating: t.rating, runtime: t.runtime, actors: t.actors, posterFile: t.poster_file,
        status: 'matched', guessed: false, locations: [],
        imdbId: t.imdb_id, genreList: t.genres ? t.genres.split(', ') : [], director: t.director, awards: t.awards,
        rated: t.rated, country: t.country, countryList: t.country ? t.country.split(', ') : [], totalSeasons: t.total_seasons, kind: kindOf(t.type), addedOrder: l.id, userTags: [],
      };
      byTitle.set(t.id, e);
      entries.push(e);
    }
    e.locations.push(shape(l));
    if (l.guessed) e.guessed = true;
  }
  // the tags of an entry's folders, once each (any letter case), in alphabetical order
  for (const e of entries) {
    const seen = new Map();
    for (const l of e.locations) for (const tag of tagsByLoc.get(l.id) ?? []) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
    e.userTags = [...seen.values()].sort((a, b) => collator.compare(a, b));
  }
  for (const e of entries) e.attention = attentionOf(e);
  entries.push(...collectionEntries(entries));
  return entries.sort(compareTitles);
}

// What the owner should look at: 'problem' (unsure or broken), 'guess' (auto-picked, check it), 'ok' (verified).
// A drive that is only unplugged is not a problem.
function attentionOf(e) {
  const present = e.locations.filter((l) => !l.missing);
  if (e.status !== 'matched' || !present.length || present.some((l) => l.isEmpty)) return 'problem';
  return e.guessed ? 'guess' : 'ok';
}

// A folder that groups two or more titles (Batman Trilogy/...) is shown as one more entry that lists them.
function collectionEntries(entries) {
  const groups = new Map();
  for (const e of entries) {
    for (const l of e.locations) {
      if (!l.collection) continue;
      const key = `${l.driveSerial}|${l.collection}`;
      if (!groups.has(key)) groups.set(key, { l, members: new Map(), locs: [] });
      const g = groups.get(key);
      g.members.set(e.key, e);
      g.locs.push(l);
    }
  }
  return [...groups.values()].filter((g) => g.members.size >= 2).map(({ l, members, locs }) => {
    const list = [...members.values()].sort(compareTitles);
    return {
      key: `c:${l.driveSerial}|${l.collection}`, kind: 'collection', titleId: null, locationId: null,
      title: l.collection.split('/').pop(), year: null, type: 'collection', plot: null, genres: null, rating: null, runtime: null,
      actors: null, posterFile: list.find((m) => m.posterFile)?.posterFile ?? null, status: 'matched', guessed: false, locations: [],
      imdbId: null, genreList: [], director: null, awards: null, rated: null, country: null, countryList: [], totalSeasons: null, attention: 'ok', userTags: [],
      addedOrder: Math.min(...locs.map((x) => x.id)),
      collection: { driveSerial: l.driveSerial, relPath: l.collection, online: l.online, missing: locs.every((x) => x.missing) },
      members: list.map((m) => ({ key: m.key, title: m.title, year: m.year, posterFile: m.posterFile, status: m.status, kind: m.kind })),
    };
  });
}

// Why an entry shows a dot, as the key of its badge text; same order the detail view lists its flags.
function reasonOf(e) {
  if (e.attention === 'guess') return 'guessed';
  if (e.attention !== 'problem') return null;
  const present = e.locations.filter((l) => !l.missing);
  if (!present.length) return 'missing';
  if (e.status === 'review') return 'review';
  if (e.status === 'pending') return 'pending';
  return 'empty';
}

// What a grid card needs. The whole entry (plot, cast, folders) is asked for when one is opened.
function lightOf(e) {
  return {
    key: e.key, title: e.title, year: e.year, rating: e.rating, posterFile: e.posterFile, kind: e.kind,
    attention: e.attention, genres: e.genreList.slice(0, 2), tags: e.userTags.slice(0, 2), reason: reasonOf(e), members: e.members ? e.members.length : 0,
  };
}

module.exports = { listEntries, reasonOf, lightOf, compareTitles };
