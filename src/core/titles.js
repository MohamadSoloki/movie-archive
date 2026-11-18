'use strict';

// Insert or update a title, keyed by imdb_id (OMDb) or mal_id (Jikan). Returns the title id.
// poster_url is kept so a failed download can be retried later; poster_file keeps its old value
// when the new download failed for the same title.
function upsertTitle(db, info, posterFile) {
  const col = info.imdbId ? 'imdb_id' : 'mal_id';
  const key = info.imdbId ?? info.malId;
  const vals = [info.source, info.title, info.year, info.type, info.plot, info.genres, info.rating,
    info.runtime, info.actors, info.director ?? null, info.awards ?? null, info.rated ?? null, info.country ?? null,
    info.totalSeasons ?? null];
  const existing = db.prepare(`SELECT id FROM titles WHERE ${col} = ?`).get(key);
  if (existing) {
    db.prepare(`UPDATE titles SET source = ?, title = ?, year = ?, type = ?, plot = ?, genres = ?, rating = ?,
      runtime = ?, actors = ?, director = ?, awards = ?, rated = ?, country = ?, total_seasons = ?, poster_url = ?, poster_file = COALESCE(?, poster_file) WHERE id = ?`)
      .run(...vals, info.posterUrl ?? null, posterFile, existing.id);
    return existing.id;
  }
  const r = db.prepare(`INSERT INTO titles(${col}, source, title, year, type, plot, genres, rating, runtime, actors, director, awards, rated, country, total_seasons, poster_url, poster_file)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key, ...vals, info.posterUrl ?? null, posterFile);
  return Number(r.lastInsertRowid);
}

module.exports = { upsertTitle };
