'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/core/db.js');
const { ProviderError } = require('../src/core/errors.js');
const { resolveLocation, runQueue } = require('../src/core/pipeline.js');
const { savePoster } = require('../src/core/posters.js');
const { upsertTitle } = require('../src/core/titles.js');

const INFO = {
  source: 'omdb', imdbId: 'tt1877830', malId: null, title: 'The Batman', year: '2022', type: 'movie',
  plot: 'p', genres: 'Action', rating: '7.8', runtime: '176 min', actors: 'a', posterUrl: 'https://x/p.jpg',
};
const ANIME = { source: 'jikan', imdbId: null, malId: 5, title: 'Naruto', year: '2002', type: 'anime',
  plot: 'p', genres: 'Action', rating: '8', runtime: '23 min', actors: null, posterUrl: null };

function deps(over = {}) {
  const calls = { byTitle: [], search: 0, jikan: 0 };
  const d = {
    omdb: {
      byTitle: async (...a) => { calls.byTitle.push(a); return INFO; },
      search: async () => { calls.search++; return []; },
    },
    jikan: { searchAnime: async () => { calls.jikan++; return null; } },
    savePoster: async (url, key) => (url ? `${key}.jpg` : null),
    ...over,
  };
  return { d, calls };
}
const notFound = async () => { throw new ProviderError('not_found'); };

let n = 0;
function addLoc(db, { title, year = null, season = null, guessed = 0, serial = 'S1' }) {
  n += 1;
  return Number(db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, parsed_year, season, guessed)
    VALUES(?, ?, ?, ?, ?, ?, ?)`).run(serial, `Movies/f${n}`, `f${n}`, title, year, season, guessed).lastInsertRowid);
}
const loc = (db, id) => db.prepare('SELECT * FROM locations WHERE id = ?').get(id);

test('OMDb hit links a title and marks the location matched', async () => {
  const db = openDb(); const { d, calls } = deps();
  const id = addLoc(db, { title: 'batman', year: '2022' });
  assert.equal(await resolveLocation(db, id, d), 'matched');
  const l = loc(db, id);
  assert.equal(l.status, 'matched');
  const t = db.prepare('SELECT * FROM titles WHERE id = ?').get(l.title_id);
  assert.deepEqual([t.imdb_id, t.title, t.poster_file], ['tt1877830', 'The Batman', 'tt1877830.jpg']);
  assert.deepEqual(calls.byTitle[0], ['batman', '2022', null]);
});

test('a Jikan failure sends the title to review instead of stopping the queue', async () => {
  const db = openDb();
  const { d } = deps({
    omdb: { byTitle: notFound, search: async () => [] },
    jikan: { searchAnime: async () => { throw new ProviderError('network'); } },
  });
  const a = addLoc(db, { title: 'x' });
  const b = addLoc(db, { title: 'y' });
  const r = await runQueue(db, d);
  assert.deepEqual([r.stoppedBy, r.processed], [null, 2]);
  assert.deepEqual([loc(db, a).status, loc(db, b).status], ['review', 'review']);
});

test('a failed poster download is retried at the start of the next run', async () => {
  const db = openDb();
  let up = false;
  const { d } = deps({ savePoster: async (url, key) => (up && url ? `${key}.jpg` : null) });
  addLoc(db, { title: 'batman', year: '2022' });
  await runQueue(db, d);
  const t = db.prepare('SELECT poster_file, poster_url FROM titles').get();
  assert.deepEqual([t.poster_file, t.poster_url], [null, 'https://x/p.jpg']);
  up = true;
  await runQueue(db, d);
  assert.equal(db.prepare('SELECT poster_file FROM titles').get().poster_file, 'tt1877830.jpg');
});

test('poster retry stops at the first failure', async () => {
  const db = openDb();
  let calls = 0;
  const { d } = deps({ savePoster: async () => { calls += 1; return null; } });
  upsertTitle(db, { ...INFO, imdbId: 'tt1' }, null);
  upsertTitle(db, { ...INFO, imdbId: 'tt2' }, null);
  await runQueue(db, d);
  assert.equal(calls, 1);
});

test('not found and one confident search hit: auto-matched and flagged guessed', async () => {
  const db = openDb(); const byIdCalls = [];
  const { d, calls } = deps({ omdb: { byTitle: notFound,
    search: async () => [{ imdbId: 'tt1877830', title: 'The Batman', year: '2022', type: 'movie', posterUrl: null }],
    byId: async (id) => { byIdCalls.push(id); return INFO; } } });
  const id = addLoc(db, { title: 'Batman', year: '2022' });
  assert.equal(await resolveLocation(db, id, d), 'matched');
  assert.deepEqual([loc(db, id).status, loc(db, id).guessed], ['matched', 1]);
  assert.deepEqual(byIdCalls, ['tt1877830']);
  assert.equal(calls.jikan, 0);
});

test('not found and an ambiguous search: review, Jikan not asked, search stored once', async () => {
  const db = openDb(); let searches = 0;
  const { d, calls } = deps({ omdb: { byTitle: notFound,
    search: async () => { searches += 1; return [{ imdbId: 'a', title: 'Dune', year: '1984', type: 'movie' }, { imdbId: 'b', title: 'Dune', year: '2021', type: 'movie' }]; } } });
  const a = addLoc(db, { title: 'Dune' });
  const b = addLoc(db, { title: 'Dune' });
  assert.equal(await resolveLocation(db, a, d), 'review');
  assert.equal(await resolveLocation(db, b, d), 'review');
  assert.equal(searches, 1);
  assert.equal(calls.jikan, 0);
});

test('a confident pick that OMDb then cannot load goes to review', async () => {
  const db = openDb();
  const { d } = deps({ omdb: { byTitle: notFound,
    search: async () => [{ imdbId: 'tt9', title: 'Batman', year: '2022', type: 'movie' }],
    byId: notFound } });
  const id = addLoc(db, { title: 'Batman', year: '2022' });
  assert.equal(await resolveLocation(db, id, d), 'review');
});

test('season folders ask OMDb for a series', async () => {
  const db = openDb(); const { d, calls } = deps();
  await resolveLocation(db, addLoc(db, { title: 'Breaking Bad', season: '02' }), d);
  assert.equal(calls.byTitle[0][2], 'series');
});

test('same parsed title and year on another drive reuses the title with no request', async () => {
  const db = openDb(); const { d, calls } = deps();
  const a = addLoc(db, { title: 'Batman', year: '2022' });
  const b = addLoc(db, { title: 'batman', year: '2022', serial: 'S2' });
  await resolveLocation(db, a, d);
  assert.equal(await resolveLocation(db, b, d), 'matched');
  assert.equal(loc(db, a).title_id, loc(db, b).title_id);
  assert.equal(calls.byTitle.length, 1);
});

test('persian-only title goes to review without any request', async () => {
  const db = openDb(); const { d, calls } = deps();
  const id = addLoc(db, { title: 'بتمن', year: '2022' });
  assert.equal(await resolveLocation(db, id, d), 'review');
  assert.equal(loc(db, id).status, 'review');
  assert.deepEqual([calls.byTitle.length, calls.search, calls.jikan], [0, 0, 0]);
});

test('not found, no search hits, Jikan hit: matched as anime', async () => {
  const db = openDb();
  const { d } = deps({ omdb: { byTitle: notFound, search: async () => [] }, jikan: { searchAnime: async () => ANIME } });
  const id = addLoc(db, { title: 'naruto' });
  assert.equal(await resolveLocation(db, id, d), 'matched');
  assert.equal(db.prepare('SELECT source FROM titles WHERE id = ?').get(loc(db, id).title_id).source, 'jikan');
});

test('search candidates exist: review, Jikan not asked', async () => {
  const db = openDb();
  const { d, calls } = deps({ omdb: { byTitle: notFound, search: async () => [{ imdbId: 'tt1' }] } });
  const id = addLoc(db, { title: 'batm' });
  assert.equal(await resolveLocation(db, id, d), 'review');
  assert.equal(calls.jikan, 0);
});

test('nothing anywhere: review', async () => {
  const db = openDb();
  const { d } = deps({ omdb: { byTitle: notFound, search: async () => [] } });
  assert.equal(await resolveLocation(db, addLoc(db, { title: 'zzzz' }), d), 'review');
});

test('quota: location stays pending, never review', async () => {
  const db = openDb();
  const { d } = deps({ omdb: { byTitle: async () => { throw new ProviderError('quota'); }, search: async () => [] } });
  const id = addLoc(db, { title: 'batman', year: '2022' });
  assert.equal(await resolveLocation(db, id, d), 'quota');
  assert.equal(loc(db, id).status, 'pending');
});

test('network error mid-queue stops the queue and leaves the rest pending', async () => {
  const db = openDb();
  let call = 0;
  const { d } = deps({ omdb: {
    byTitle: async () => { call++; if (call === 2) throw new ProviderError('network'); return { ...INFO, imdbId: `tt000000${call}` }; },
    search: async () => [],
  } });
  const ids = ['a', 'b', 'c'].map((t) => addLoc(db, { title: t }));
  const r = await runQueue(db, d);
  assert.deepEqual(r, { processed: 1, remaining: 2, stoppedBy: 'network', episodes: 0 });
  assert.deepEqual(ids.map((i) => loc(db, i).status), ['matched', 'pending', 'pending']);
});

test('runQueue reports progress and skips missing locations', async () => {
  const db = openDb(); const { d } = deps();
  addLoc(db, { title: 'a' });
  const gone = addLoc(db, { title: 'b' });
  db.prepare('UPDATE locations SET missing = 1 WHERE id = ?').run(gone);
  const seen = [];
  const r = await runQueue(db, d, (p) => seen.push(p));
  assert.deepEqual(r, { processed: 1, remaining: 0, stoppedBy: null, episodes: 0 });
  assert.deepEqual(seen, [{ processed: 1, remaining: 0 }]);
  assert.equal(loc(db, gone).status, 'pending');
});

test('poster failure does not fail the match', async () => {
  const db = openDb();
  const { d } = deps({ savePoster: async () => null });
  const id = addLoc(db, { title: 'batman', year: '2022' });
  assert.equal(await resolveLocation(db, id, d), 'matched');
  assert.equal(db.prepare('SELECT poster_file FROM titles WHERE id = ?').get(loc(db, id).title_id).poster_file, null);
});

test('guessed flag survives a successful match', async () => {
  const db = openDb(); const { d } = deps();
  const id = addLoc(db, { title: 'Some Movie', guessed: 1 });
  await resolveLocation(db, id, d);
  assert.deepEqual([loc(db, id).status, loc(db, id).guessed], ['matched', 1]);
});

test('savePoster writes the file and returns its name; failures give null', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poster-')), 'posters');
  const ok = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  assert.equal(await savePoster('https://x/p.jpg', dir, 'tt1', ok), 'tt1.jpg');
  assert.deepEqual([...fs.readFileSync(path.join(dir, 'tt1.jpg'))], [1, 2, 3]);
  assert.equal(await savePoster(null, dir, 'tt2', ok), null);
  assert.equal(await savePoster('https://x/p.jpg', dir, 'tt3', async () => ({ ok: false })), null);
  assert.equal(await savePoster('https://x/p.jpg', dir, 'tt4', async () => { throw new Error('down'); }), null);
});

test('runQueue fetches episodes after the locations and reports how many; a stopped location loop skips them', async () => {
  const db = openDb();
  const seasonCalls = [];
  const mk = (over = {}) => deps({ sleep: async () => {}, omdb: {
    byTitle: async () => ({ ...INFO, type: 'series' }), search: async () => [],
    season: async (id, s) => { seasonCalls.push(s); return { totalSeasons: 1, episodes: [{ number: 1, name: 'E', released: null, rating: '8', imdbId: 'tt11' }] }; },
    byId: async () => ({ plot: 'p', rating: null }), ...over } }).d;
  addLoc(db, { title: 'batman', year: '2022', season: '01' });
  const r = await runQueue(db, mk());
  assert.deepEqual([r.stoppedBy, r.episodes, seasonCalls], [null, 2, [1]]);
  addLoc(db, { title: 'other' });
  seasonCalls.length = 0;
  const stopped = await runQueue(db, mk({ byTitle: async () => { throw new ProviderError('network'); } }));
  assert.deepEqual([stopped.stoppedBy, stopped.episodes, seasonCalls], ['network', 0, []]);
});

test('a season folder is not merged into a movie with the same name', async () => {
  const db = openDb(); const { d, calls } = deps();
  const movie = addLoc(db, { title: 'Fargo' });
  const show = addLoc(db, { title: 'Fargo', season: '01', serial: 'S2' });
  await resolveLocation(db, movie, d);
  calls.byTitle.length = 0;
  await resolveLocation(db, show, d);
  assert.equal(calls.byTitle.length, 1);
  assert.equal(calls.byTitle[0][2], 'series');
});

const tick = (ms = 5) => new Promise((r) => { setTimeout(r, ms); });

test('concurrency: several locations are resolved at once, never more than the limit', async () => {
  const db = openDb(); let live = 0; let peak = 0; let k = 0;
  const { d } = deps({
    concurrency: 3,
    omdb: { byTitle: async (t) => { live += 1; peak = Math.max(peak, live); await tick(); live -= 1; k += 1; return { ...INFO, imdbId: `tt${k}`, title: t }; }, search: async () => [] },
  });
  const ids = Array.from({ length: 8 }, (_, i) => addLoc(db, { title: `film ${i}` }));
  const r = await runQueue(db, d);
  assert.equal(peak, 3);
  assert.deepEqual([r.processed, r.remaining, r.stoppedBy], [8, 0, null]);
  assert.ok(ids.every((id) => loc(db, id).status === 'matched'));
});

test('concurrency: two folders of the same film cost one request', async () => {
  const db = openDb(); let asked = 0;
  const { d } = deps({ concurrency: 4, omdb: { byTitle: async () => { asked += 1; await tick(); return INFO; }, search: async () => [] } });
  const a = addLoc(db, { title: 'batman', year: '2022', serial: 'S1' });
  const b = addLoc(db, { title: 'Batman', year: '2022', serial: 'S2' });
  await runQueue(db, d);
  assert.equal(asked, 1);
  assert.equal(loc(db, a).title_id, loc(db, b).title_id);
});

test('concurrency: a network error stops new work; failed and unstarted locations stay pending', async () => {
  const db = openDb(); let started = 0;
  const { d } = deps({
    concurrency: 2,
    omdb: { byTitle: async (t) => { started += 1; await tick(); if (t === 'film 1') throw new ProviderError('network'); return { ...INFO, imdbId: `tt${t}`, title: t }; }, search: async () => [] },
  });
  const ids = Array.from({ length: 10 }, (_, i) => addLoc(db, { title: `film ${i}` }));
  const r = await runQueue(db, d);
  assert.equal(r.stoppedBy, 'network');
  assert.ok(started < 10);
  assert.equal(loc(db, ids[1]).status, 'pending');
  assert.equal(r.processed + r.remaining, 10);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM locations WHERE status = 'pending'").get().c, r.remaining);
});

test('poster retries run together and stop after the first failure', async () => {
  const db = openDb(); let live = 0; let peak = 0;
  for (let i = 0; i < 6; i += 1) upsertTitle(db, { ...INFO, imdbId: `tt${i}`, posterUrl: 'https://x/p.jpg' }, null);
  const { d } = deps({ concurrency: 3, savePoster: async (u, key) => { live += 1; peak = Math.max(peak, live); await tick(); live -= 1; return `${key}.jpg`; } });
  await runQueue(db, d);
  assert.equal(peak, 3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM titles WHERE poster_file IS NULL').get().c, 0);
});
