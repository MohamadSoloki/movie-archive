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
  assert.deepEqual(r, { processed: 1, remaining: 2, stoppedBy: 'network' });
  assert.deepEqual(ids.map((i) => loc(db, i).status), ['matched', 'pending', 'pending']);
});

test('runQueue reports progress and skips missing locations', async () => {
  const db = openDb(); const { d } = deps();
  addLoc(db, { title: 'a' });
  const gone = addLoc(db, { title: 'b' });
  db.prepare('UPDATE locations SET missing = 1 WHERE id = ?').run(gone);
  const seen = [];
  const r = await runQueue(db, d, (p) => seen.push(p));
  assert.deepEqual(r, { processed: 1, remaining: 0, stoppedBy: null });
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
