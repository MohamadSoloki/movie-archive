'use strict';
const { upsertTitle } = require('./titles.js');

const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /[A-Za-z]/;
const STOPS = new Set(['quota', 'network', 'bad_key']);

// Jikan is a best-effort fallback: its failure must not stop the queue or look like "no internet"
async function animeOrNull(jikan, title, year) {
  try {
    return await jikan.searchAnime(title, year);
  } catch {
    return null;
  }
}

// Titles whose poster download failed earlier. Stops at the first failure: the host is probably unreachable.
async function backfillPosters(db, deps) {
  const rows = db.prepare('SELECT id, imdb_id, mal_id, poster_url FROM titles WHERE poster_file IS NULL AND poster_url IS NOT NULL').all();
  for (const r of rows) {
    const file = await deps.savePoster(r.poster_url, r.imdb_id ?? `mal${r.mal_id}`);
    if (!file) return;
    db.prepare('UPDATE titles SET poster_file = ? WHERE id = ?').run(file, r.id);
  }
}

async function resolveLocation(db, id, deps) {
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  const setStatus = (status, titleId = null) =>
    db.prepare('UPDATE locations SET status = ?, title_id = ? WHERE id = ?').run(status, titleId, id);
  const t = loc.parsed_title || '';

  // another location already matched the same title: no request needed
  const twin = db.prepare(`SELECT title_id FROM locations WHERE id != ? AND status = 'matched' AND title_id IS NOT NULL
    AND lower(parsed_title) = lower(?) AND parsed_year IS ?`).get(id, t, loc.parsed_year);
  if (twin) { setStatus('matched', twin.title_id); return 'matched'; }

  // OMDb and Jikan only know English titles
  if (ARABIC.test(t) && !LATIN.test(t)) { setStatus('review'); return 'review'; }

  try {
    let info;
    try {
      info = await deps.omdb.byTitle(t, loc.parsed_year, loc.season ? 'series' : null);
    } catch (e) {
      if (e.kind !== 'not_found') throw e;
      if ((await deps.omdb.search(t, loc.parsed_year)).length) { setStatus('review'); return 'review'; }
      info = await animeOrNull(deps.jikan, t, loc.parsed_year);
      if (!info) { setStatus('review'); return 'review'; }
    }
    const poster = await deps.savePoster(info.posterUrl, info.imdbId ?? `mal${info.malId}`);
    setStatus('matched', upsertTitle(db, info, poster));
    return 'matched';
  } catch (e) {
    if (STOPS.has(e.kind)) return e.kind; // stays pending, retried on the next run
    throw e;
  }
}

async function runQueue(db, deps, onProgress) {
  await backfillPosters(db, deps);
  const ids = db.prepare("SELECT id FROM locations WHERE status = 'pending' AND missing = 0 ORDER BY id").all().map((r) => r.id);
  let processed = 0;
  let stoppedBy = null;
  for (const id of ids) {
    const r = await resolveLocation(db, id, deps);
    if (STOPS.has(r)) { stoppedBy = r; break; }
    processed += 1;
    if (onProgress) onProgress({ processed, remaining: ids.length - processed });
  }
  return { processed, remaining: ids.length - processed, stoppedBy };
}

module.exports = { resolveLocation, runQueue };
