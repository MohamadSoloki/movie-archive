'use strict';
const { getCache, putCache } = require('./cache.js');

const STOPS = new Set(['quota', 'network', 'bad_key']);
const JIKAN_PAUSE = 400; // Jikan allows about 3 requests a second
const realSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Seasons the user has folders for. A folder without a season token means the whole show.
function ownedSeasons(db, titleId) {
  const locs = db.prepare('SELECT season FROM locations WHERE title_id = ? AND missing = 0').all(titleId);
  if (locs.some((l) => !l.season)) {
    const total = db.prepare('SELECT total_seasons FROM titles WHERE id = ?').get(titleId)?.total_seasons || 1;
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  return [...new Set(locs.map((l) => Number(l.season)))].sort((a, b) => a - b);
}

const noneKey = (titleId, season) => `season-none:${titleId}:${season}`;
const hasRows = (db, titleId, season) => !!db.prepare('SELECT 1 FROM episodes WHERE title_id = ? AND season = ?').get(titleId, season);

function insertEpisodes(db, titleId, season, list) {
  const ins = db.prepare('INSERT OR IGNORE INTO episodes(title_id, season, number, ext_id, name, released, rating) VALUES(?, ?, ?, ?, ?, ?, ?)');
  let stored = 0;
  for (const e of list) {
    if (Number.isInteger(e.number)) stored += Number(ins.run(titleId, season, e.number, e.imdbId ?? null, e.name ?? null, e.released ?? null, e.rating ?? null).changes);
  }
  return stored;
}

async function runEpisodes(db, deps) {
  const { omdb, jikan, sleep = realSleep } = deps;
  const titles = db.prepare(`SELECT id, imdb_id, mal_id, source FROM titles
    WHERE (type = 'series' OR source = 'jikan')
      AND id IN (SELECT title_id FROM locations WHERE title_id IS NOT NULL AND missing = 0) ORDER BY id`).all();
  let fetched = 0;
  let jikanUsed = false;
  const pause = async () => { if (jikanUsed) await sleep(JIKAN_PAUSE); jikanUsed = true; };

  try {
    // phase A: season / episode lists of every title first, so the cheap requests are never starved by plots
    for (const t of titles) {
      if (t.source === 'jikan') {
        if (hasRows(db, t.id, 1) || getCache(db, noneKey(t.id, 1)) !== undefined) continue;
        await pause();
        const list = await jikan.episodes(t.mal_id);
        const stored = insertEpisodes(db, t.id, 1, list);
        if (stored) fetched += 1; else putCache(db, noneKey(t.id, 1), 1);
        continue;
      }
      // the owned list is recomputed each round: season 1 can teach us how many seasons exist
      for (;;) {
        const season = ownedSeasons(db, t.id).find((s) => !hasRows(db, t.id, s) && getCache(db, noneKey(t.id, s)) === undefined);
        if (season === undefined) break;
        let answer;
        try {
          answer = await omdb.season(t.imdb_id, season);
        } catch (e) {
          if (e.kind !== 'not_found') throw e;
          putCache(db, noneKey(t.id, season), 1);
          continue;
        }
        if (answer.totalSeasons) db.prepare('UPDATE titles SET total_seasons = ? WHERE id = ?').run(answer.totalSeasons, t.id);
        if (insertEpisodes(db, t.id, season, answer.episodes)) fetched += 1; else putCache(db, noneKey(t.id, season), 1);
      }
    }

    // phase B: one request per episode plot
    const setPlot = db.prepare('UPDATE episodes SET plot = ?, rating = COALESCE(?, rating) WHERE title_id = ? AND season = ? AND number = ?');
    for (const t of titles) {
      const seasons = t.source === 'jikan' ? [1] : ownedSeasons(db, t.id);
      const rows = db.prepare('SELECT season, number, ext_id FROM episodes WHERE title_id = ? AND plot IS NULL ORDER BY season, number')
        .all(t.id).filter((r) => seasons.includes(r.season));
      for (const r of rows) {
        let plot = '';
        let rating = null;
        if (t.source === 'jikan') {
          await pause();
          plot = (await jikan.episode(t.mal_id, r.number)) || '';
        } else if (r.ext_id) {
          try {
            const info = await omdb.byId(r.ext_id);
            plot = info.plot || '';
            rating = info.rating ?? null;
          } catch (e) {
            if (e.kind !== 'not_found') throw e;
          }
        }
        setPlot.run(plot, rating, t.id, r.season, r.number);
        fetched += 1;
      }
    }
  } catch (e) {
    if (STOPS.has(e.kind)) return { fetched, stoppedBy: e.kind };
    throw e;
  }
  return { fetched, stoppedBy: null };
}

module.exports = { ownedSeasons, runEpisodes };
