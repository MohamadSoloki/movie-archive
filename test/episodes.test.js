'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { ProviderError } = require('../src/core/errors.js');
const { upsertTitle } = require('../src/core/titles.js');
const { ownedSeasons, runEpisodes } = require('../src/core/episodes.js');

const SERIES = { source: 'omdb', imdbId: 'tt0758745', malId: null, title: 'The Mentalist', year: '2008', type: 'series',
  plot: 'p', genres: 'Crime', rating: '8.1', runtime: '43 min', actors: 'a', posterUrl: null, totalSeasons: 3 };
const ANIME = { source: 'jikan', imdbId: null, malId: 5, title: 'Naruto', year: '2002', type: 'anime',
  plot: 'p', genres: 'Action', rating: '8', runtime: '23 min', actors: null, posterUrl: null };

let n = 0;
function addLoc(db, titleId, season = null, missing = 0) {
  n += 1;
  db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, season, title_id, status, missing)
    VALUES('S1', ?, ?, 'x', ?, ?, 'matched', ?)`).run(`Series/f${n}`, `f${n}`, season, titleId, missing);
}
const sleeps = [];
function fakes(over = {}) {
  const calls = { season: [], byId: [], episodes: [], episode: [] };
  return { calls, d: {
    sleep: async (ms) => { sleeps.push(ms); },
    omdb: {
      season: async (id, s) => { calls.season.push(s); return { totalSeasons: 3, episodes: [1, 2].map((i) => ({ number: i, name: `E${i}`, released: '2008-01-01', rating: '8.0', imdbId: `tt${s}${i}` })) }; },
      byId: async (id) => { calls.byId.push(id); return { plot: `plot ${id}`, rating: '9.1' }; },
    },
    jikan: {
      episodes: async (m) => { calls.episodes.push(m); return [{ number: 1, name: 'A', released: null, rating: '7.5' }, { number: 2, name: 'B', released: null, rating: null }]; },
      episode: async (m, k) => { calls.episode.push(k); return k === 2 ? null : `syn ${k}`; },
    },
    ...over,
  } };
}
const eps = (db, id) => db.prepare('SELECT season, number, plot, rating FROM episodes WHERE title_id = ? ORDER BY season, number').all(id);

test('ownedSeasons: season folders only, or every season when a folder has no season', () => {
  const db = openDb();
  const t = upsertTitle(db, SERIES, null);
  addLoc(db, t, '03'); addLoc(db, t, '01'); addLoc(db, t, '02', 1);
  assert.deepEqual(ownedSeasons(db, t), [1, 3]);
  addLoc(db, t, null);
  assert.deepEqual(ownedSeasons(db, t), [1, 2, 3]);
  const u = upsertTitle(db, { ...SERIES, imdbId: 'tt2', totalSeasons: null }, null);
  addLoc(db, u, null);
  assert.deepEqual(ownedSeasons(db, u), [1]);
});

test('only owned seasons are requested; plots and ratings are stored; N/A plot becomes empty', async () => {
  const db = openDb(); const { d, calls } = fakes();
  const t = upsertTitle(db, SERIES, null);
  addLoc(db, t, '01'); addLoc(db, t, '03');
  d.omdb.byId = async (id) => { calls.byId.push(id); return id === 'tt32' ? { plot: null, rating: null } : { plot: `plot ${id}`, rating: '9.1' }; };
  const r = await runEpisodes(db, d);
  assert.deepEqual(calls.season, [1, 3]);
  assert.deepEqual(calls.byId.sort(), ['tt11', 'tt12', 'tt31', 'tt32']);
  assert.deepEqual([r.stoppedBy, r.fetched], [null, 6]);
  const rows = eps(db, t);
  assert.deepEqual(rows.map((e) => [e.season, e.number, e.plot, e.rating]),
    [[1, 1, 'plot tt11', '9.1'], [1, 2, 'plot tt12', '9.1'], [3, 1, 'plot tt31', '9.1'], [3, 2, '', '8.0']]);
});

test('a folder without a season fetches every season', async () => {
  const db = openDb(); const { d, calls } = fakes();
  addLoc(db, upsertTitle(db, SERIES, null), null);
  await runEpisodes(db, d);
  assert.deepEqual(calls.season, [1, 2, 3]);
});

test('quota stops the run; the next run asks only for plots still missing, no season lists', async () => {
  const db = openDb(); const { d, calls } = fakes();
  const t = upsertTitle(db, SERIES, null);
  addLoc(db, t, '01');
  let k = 0;
  d.omdb.byId = async (id) => { k += 1; if (k === 2) throw new ProviderError('quota'); calls.byId.push(id); return { plot: 'p', rating: null }; };
  assert.equal((await runEpisodes(db, d)).stoppedBy, 'quota');
  assert.deepEqual(eps(db, t).map((e) => e.plot), ['p', null]);
  const again = fakes();
  const r = await runEpisodes(db, again.d);
  assert.deepEqual([again.calls.season, again.calls.byId, r.stoppedBy], [[], ['tt12'], null]);
});

test('a season OMDb does not know is remembered and never requested again', async () => {
  const db = openDb(); const { d, calls } = fakes();
  const t = upsertTitle(db, SERIES, null);
  addLoc(db, t, '01');
  d.omdb.season = async (id, s) => { calls.season.push(s); throw new ProviderError('not_found'); };
  await runEpisodes(db, d); await runEpisodes(db, d);
  assert.equal(calls.season.length, 1);
  assert.equal(eps(db, t).length, 0);
  assert.ok(db.prepare("SELECT 1 FROM cache WHERE key = ?").get(`season-none:${t}:1`));
});

test('an episode OMDb cannot find gets an empty plot, once', async () => {
  const db = openDb(); const { d, calls } = fakes();
  const t = upsertTitle(db, SERIES, null);
  addLoc(db, t, '01');
  d.omdb.byId = async (id) => { calls.byId.push(id); throw new ProviderError('not_found'); };
  await runEpisodes(db, d); await runEpisodes(db, d);
  assert.equal(calls.byId.length, 2);
  assert.deepEqual(eps(db, t).map((e) => e.plot), ['', '']);
});

test('season list learns total seasons', async () => {
  const db = openDb(); const { d } = fakes();
  const t = upsertTitle(db, { ...SERIES, totalSeasons: null }, null);
  addLoc(db, t, null);
  await runEpisodes(db, d);
  assert.equal(db.prepare('SELECT total_seasons FROM titles WHERE id = ?').get(t).total_seasons, 3);
  assert.equal(new Set(eps(db, t).map((e) => e.season)).size, 3);
});

test('anime: one episode list, one synopsis request per episode, a pause between requests', async () => {
  sleeps.length = 0;
  const db = openDb(); const { d, calls } = fakes();
  const t = upsertTitle(db, ANIME, null);
  addLoc(db, t, null);
  const r = await runEpisodes(db, d);
  assert.deepEqual([calls.episodes, calls.episode], [[5], [1, 2]]);
  assert.deepEqual(eps(db, t).map((e) => [e.season, e.number, e.plot, e.rating]), [[1, 1, 'syn 1', '7.5'], [1, 2, '', null]]);
  assert.ok(sleeps.length >= 2 && sleeps.every((ms) => ms === 400));
  assert.equal(r.stoppedBy, null);
});

test('titles with only missing folders and non-series titles are left alone', async () => {
  const db = openDb(); const { d, calls } = fakes();
  addLoc(db, upsertTitle(db, SERIES, null), null, 1);
  addLoc(db, upsertTitle(db, { ...SERIES, imdbId: 'tt3', type: 'movie' }, null), null);
  await runEpisodes(db, d);
  assert.deepEqual(calls.season, []);
});

test('network error from a season list stops the run', async () => {
  const db = openDb(); const { d } = fakes();
  addLoc(db, upsertTitle(db, SERIES, null), '01');
  d.omdb.season = async () => { throw new ProviderError('network'); };
  assert.deepEqual(await runEpisodes(db, d), { fetched: 0, stoppedBy: 'network' });
});

test('an unexpected error is thrown, not swallowed', async () => {
  const db = openDb(); const { d } = fakes();
  addLoc(db, upsertTitle(db, SERIES, null), '01');
  d.omdb.season = async () => { throw new TypeError('bug'); };
  await assert.rejects(runEpisodes(db, d), TypeError);
});

const tick = (ms = 5) => new Promise((r) => { setTimeout(r, ms); });

test('concurrency: episode plots are fetched together, never more than the limit, and all stored', async () => {
  const db = openDb(); const { d } = fakes();
  const t = upsertTitle(db, SERIES, null);
  addLoc(db, t, null);
  let live = 0; let peak = 0;
  d.concurrency = 4;
  d.omdb.byId = async (id) => { live += 1; peak = Math.max(peak, live); await tick(); live -= 1; return { plot: `plot ${id}`, rating: '9.1' }; };
  const r = await runEpisodes(db, d);
  assert.equal(peak, 4);
  assert.equal(r.stoppedBy, null);
  assert.equal(eps(db, t).length, 6);
  assert.ok(eps(db, t).every((e) => e.plot));
});

test('concurrency: season lists of different series are fetched together', async () => {
  const db = openDb(); const { d } = fakes();
  for (let i = 0; i < 4; i += 1) addLoc(db, upsertTitle(db, { ...SERIES, imdbId: `tt${100 + i}` }, null), '01');
  let live = 0; let peak = 0;
  d.concurrency = 4;
  d.omdb.season = async (id, s) => { live += 1; peak = Math.max(peak, live); await tick(); live -= 1; return { totalSeasons: 3, episodes: [{ number: 1, name: 'E', released: null, rating: null, imdbId: `${id}-${s}` }] }; };
  await runEpisodes(db, d);
  assert.equal(peak, 4);
});

test('concurrency: quota stops new requests; what was stored stays and the next run finishes the rest', async () => {
  const db = openDb(); const { d } = fakes();
  const t = upsertTitle(db, SERIES, null);
  addLoc(db, t, null);
  d.concurrency = 2;
  let k = 0;
  d.omdb.byId = async (id) => { k += 1; const mine = k; await tick(); if (mine === 3) throw new ProviderError('quota'); return { plot: `p ${id}`, rating: null }; };
  assert.equal((await runEpisodes(db, d)).stoppedBy, 'quota');
  const got = eps(db, t).filter((e) => e.plot !== null).length;
  assert.ok(got >= 2 && got < 6);
  const again = fakes();
  await runEpisodes(db, again.d);
  assert.equal(again.calls.byId.length, 6 - got);
  assert.equal(eps(db, t).filter((e) => e.plot === null).length, 0);
});
