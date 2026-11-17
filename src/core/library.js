'use strict';

function listEntries(db) {
  const locs = db.prepare(`SELECT l.*, d.label AS drive_label, COALESCE(d.online, 0) AS drive_online
    FROM locations l LEFT JOIN drives d ON d.serial = l.drive_serial ORDER BY l.id`).all();
  const titles = new Map(db.prepare('SELECT * FROM titles').all().map((t) => [t.id, t]));
  const shape = (l) => ({
    id: l.id, driveSerial: l.drive_serial, driveLabel: l.drive_label || '', online: !!l.drive_online,
    relPath: l.rel_path, folderName: l.folder_name, season: l.season, isEmpty: !!l.is_empty, missing: !!l.missing,
  });

  const entries = [];
  const byTitle = new Map();
  for (const l of locs) {
    const t = l.title_id != null ? titles.get(l.title_id) : null;
    if (!t) {
      entries.push({
        key: `l:${l.id}`, titleId: null, locationId: l.id, title: l.parsed_title || l.folder_name, year: l.parsed_year,
        type: null, plot: null, genres: null, rating: null, runtime: null, actors: null, posterFile: null,
        status: l.status, guessed: !!l.guessed, locations: [shape(l)],
      });
      continue;
    }
    let e = byTitle.get(t.id);
    if (!e) {
      e = {
        key: `t:${t.id}`, titleId: t.id, locationId: null, title: t.title, year: t.year, type: t.type, plot: t.plot,
        genres: t.genres, rating: t.rating, runtime: t.runtime, actors: t.actors, posterFile: t.poster_file,
        status: 'matched', guessed: false, locations: [],
      };
      byTitle.set(t.id, e);
      entries.push(e);
    }
    e.locations.push(shape(l));
    if (l.guessed) e.guessed = true;
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

module.exports = { listEntries };
