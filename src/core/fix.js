'use strict';
const { extractImdbId } = require('./link.js');
const { upsertTitle } = require('./titles.js');

// target: { titleId } or { locationId }. A location that already has a title fixes that whole title.
async function applyFix(db, target, link, deps) {
  const imdbId = extractImdbId(link);
  if (!imdbId) return { ok: false, error: 'invalid_link' };

  let info;
  try {
    info = await deps.omdb.byId(imdbId);
  } catch (e) {
    if (e.kind) return { ok: false, error: e.kind };
    throw e;
  }
  const poster = await deps.savePoster(info.posterUrl, imdbId);

  const loc = target.locationId != null ? db.prepare('SELECT title_id FROM locations WHERE id = ?').get(target.locationId) : null;
  const oldTitleId = target.titleId ?? loc?.title_id ?? null;
  const locIds = oldTitleId != null
    ? db.prepare('SELECT id FROM locations WHERE title_id = ?').all(oldTitleId).map((r) => r.id)
    : [target.locationId];

  db.exec('BEGIN');
  try {
    const taken = db.prepare('SELECT id FROM titles WHERE imdb_id = ?').get(imdbId);
    if (!taken && oldTitleId != null) {
      // re-point the existing row at the new id; upsertTitle below then refreshes its fields
      // poster_file is cleared too: the old file belongs to a different movie
      db.prepare('UPDATE titles SET imdb_id = ?, mal_id = NULL, poster_file = NULL WHERE id = ?').run(imdbId, oldTitleId);
    }
    const titleId = upsertTitle(db, info, poster);
    const pin = db.prepare("UPDATE locations SET title_id = ?, status = 'matched', pinned = 1, guessed = 0 WHERE id = ?");
    for (const id of locIds) pin.run(titleId, id);
    if (oldTitleId != null && oldTitleId !== titleId
      && !db.prepare('SELECT 1 FROM locations WHERE title_id = ?').get(oldTitleId)) {
      db.prepare('DELETE FROM titles WHERE id = ?').run(oldTitleId);
    }
    db.exec('COMMIT');
    return { ok: true, titleId };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// A typed query (for example an English title for a Persian folder) is searched as typed, with no year.
function getCandidates(db, locationId, deps, query = '') {
  if (query.trim()) return deps.omdb.search(query.trim());
  const loc = db.prepare('SELECT parsed_title, parsed_year FROM locations WHERE id = ?').get(locationId);
  return deps.omdb.search(loc.parsed_title, loc.parsed_year);
}

const pickCandidate = (db, locationId, imdbId, deps) => applyFix(db, { locationId }, imdbId, deps);

module.exports = { applyFix, getCandidates, pickCandidate };
