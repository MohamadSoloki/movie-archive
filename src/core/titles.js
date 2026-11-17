'use strict';

// Insert or update a title, keyed by imdb_id (OMDb) or mal_id (Jikan). Returns the title id.
function upsertTitle(db, info, posterFile) {
  const col = info.imdbId ? 'imdb_id' : 'mal_id';
  const key = info.imdbId ?? info.malId;
  const vals = [info.source, info.title, info.year, info.type, info.plot, info.genres, info.rating,
    info.runtime, info.actors];
  const existing = db.prepare(`SELECT id FROM titles WHERE ${col} = ?`).get(key);
  if (existing) {
    db.prepare(`UPDATE titles SET source = ?, title = ?, year = ?, type = ?, plot = ?, genres = ?, rating = ?,
      runtime = ?, actors = ?, poster_file = COALESCE(?, poster_file) WHERE id = ?`).run(...vals, posterFile, existing.id);
    return existing.id;
  }
  const r = db.prepare(`INSERT INTO titles(${col}, source, title, year, type, plot, genres, rating, runtime, actors, poster_file)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key, ...vals, posterFile);
  return Number(r.lastInsertRowid);
}

module.exports = { upsertTitle };
