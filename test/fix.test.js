'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { ProviderError } = require('../src/core/errors.js');
const { upsertTitle } = require('../src/core/titles.js');
const { applyFix, getCandidates, pickCandidate } = require('../src/core/fix.js');
const { syncScan } = require('../src/core/sync.js');

const mk = (imdbId, title) => ({ source: 'omdb', imdbId, malId: null, title, year: '2022', type: 'movie', plot: `plot ${title}`,
  genres: 'g', rating: '7', runtime: '100 min', actors: 'a', posterUrl: `https://x/${imdbId}.jpg` });
const BY_ID = { tt1877830: mk('tt1877830', 'The Batman'), tt0096895: mk('tt0096895', 'Batman') };

function deps(over = {}) {
  const calls = { byId: [], search: [] };
  return { calls, d: {
    omdb: {
      byId: async (id) => { calls.byId.push(id); if (!BY_ID[id]) throw new ProviderError('not_found'); return BY_ID[id]; },
      search: async (...a) => { calls.search.push(a); return [{ imdbId: 'tt1877830' }]; },
    },
    savePoster: async (url, key) => `${key}.jpg`,
    ...over,
  } };
}
let n = 0;
function addLoc(db, { title = 'batman', year = '2022', titleId = null, serial = 'S1', status = 'pending' } = {}) {
  n += 1;
  return Number(db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, parsed_year, title_id, status)
    VALUES(?, ?, ?, ?, ?, ?, ?)`).run(serial, `Movies/g${n}`, `g${n}`, title, year, titleId, status).lastInsertRowid);
}
const loc = (db, id) => db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
const dump = (db) => JSON.stringify(['titles', 'locations', 'settings'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()));

test('a link without an imdb id is rejected before any request', async () => {
  const db = openDb(); const { d, calls } = deps();
  const id = addLoc(db);
  assert.deepEqual(await applyFix(db, { locationId: id }, 'https://example.com', d), { ok: false, error: 'invalid_link' });
  assert.equal(calls.byId.length, 0);
});

test('an OMDb link is read for its id only; the api key is never stored', async () => {
  const db = openDb(); const { d, calls } = deps();
  const id = addLoc(db);
  const r = await applyFix(db, { locationId: id }, 'http://www.omdbapi.com/?i=tt1877830&apikey=SECRET123', d);
  assert.equal(r.ok, true);
  assert.deepEqual(calls.byId, ['tt1877830']);
  assert.ok(!dump(db).includes('SECRET123'));
});

test('fixing a title whose new poster is unavailable does not keep the old movie poster', async () => {
  const db = openDb(); const { d } = deps({ savePoster: async () => null });
  const t = upsertTitle(db, mk('tt0096895', 'Batman'), 'old.jpg');
  addLoc(db, { titleId: t, status: 'matched' });
  await applyFix(db, { titleId: t }, 'tt1877830', d);
  const row = db.prepare('SELECT poster_file, poster_url FROM titles WHERE id = ?').get(t);
  assert.deepEqual([row.poster_file, row.poster_url], [null, 'https://x/tt1877830.jpg']);
});

test('getCandidates with a typed query searches that text without the folder year', async () => {
  const db = openDb(); const { d, calls } = deps();
  const id = addLoc(db, { title: 'بتمن', year: '2022' });
  await getCandidates(db, id, d, 'The Batman');
  assert.deepEqual(calls.search.at(-1), ['The Batman']);
});

test('fixing a matched title updates the same row and pins its locations', async () => {
  const db = openDb(); const { d } = deps();
  const t = upsertTitle(db, mk('tt0096895', 'Batman'), 'old.jpg');
  const id = addLoc(db, { titleId: t, status: 'matched' });
  const r = await applyFix(db, { titleId: t }, 'https://www.imdb.com/title/tt1877830/', d);
  assert.deepEqual(r, { ok: true, titleId: t });
  const row = db.prepare('SELECT * FROM titles WHERE id = ?').get(t);
  assert.deepEqual([row.imdb_id, row.title, row.poster_file], ['tt1877830', 'The Batman', 'tt1877830.jpg']);
  assert.deepEqual([loc(db, id).pinned, loc(db, id).status], [1, 'matched']);
});

test('fixing a review location with no title creates one', async () => {
  const db = openDb(); const { d } = deps();
  const id = addLoc(db, { status: 'review' });
  const r = await applyFix(db, { locationId: id }, 'tt1877830', d);
  assert.equal(r.ok, true);
  assert.deepEqual([loc(db, id).status, loc(db, id).pinned, loc(db, id).title_id], ['matched', 1, r.titleId]);
});

test('fix that points at an existing title merges locations and drops the emptied title', async () => {
  const db = openDb(); const { d } = deps();
  const a = upsertTitle(db, mk('tt1877830', 'The Batman'), 'a.jpg');
  const b = upsertTitle(db, mk('tt0096895', 'Batman'), 'b.jpg');
  const la = addLoc(db, { titleId: a, status: 'matched' });
  const lb = addLoc(db, { titleId: b, status: 'matched', serial: 'S2' });
  const r = await applyFix(db, { titleId: b }, 'tt1877830', d);
  assert.deepEqual(r, { ok: true, titleId: a });
  assert.equal(loc(db, lb).title_id, a);
  assert.equal(loc(db, la).title_id, a);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM titles WHERE id = ?').get(b).c, 0);
});

test('provider errors are returned and nothing changes', async () => {
  for (const kind of ['not_found', 'quota', 'network', 'bad_key']) {
    const db = openDb();
    const { d } = deps({ omdb: { byId: async () => { throw new ProviderError(kind); } } });
    const id = addLoc(db, { status: 'review' });
    const before = dump(db);
    assert.deepEqual(await applyFix(db, { locationId: id }, 'tt1877830', d), { ok: false, error: kind });
    assert.equal(dump(db), before);
  }
});

test('a fixed location is not re-parsed or re-matched by a later scan', async () => {
  const db = openDb(); const { d } = deps();
  const id = addLoc(db, { status: 'review' });
  await applyFix(db, { locationId: id }, 'tt1877830', d);
  const row = loc(db, id);
  syncScan(db, { driveSerial: 'S1', rootRel: 'Movies', patterns: ['{title}'],
    scan: { ok: true, entries: [{ name: row.folder_name, relPath: row.rel_path, isEmpty: false }] } });
  const after = loc(db, id);
  assert.deepEqual([after.parsed_title, after.status, after.title_id], [row.parsed_title, 'matched', row.title_id]);
});

test('getCandidates searches with the parsed title and year', async () => {
  const db = openDb(); const { d, calls } = deps();
  const id = addLoc(db, { title: 'batm', year: '2022' });
  assert.equal((await getCandidates(db, id, d)).length, 1);
  assert.deepEqual(calls.search[0], ['batm', '2022']);
});

test('pickCandidate is a fix by bare id', async () => {
  const db = openDb(); const { d } = deps();
  const id = addLoc(db, { status: 'review' });
  assert.equal((await pickCandidate(db, id, 'tt1877830', d)).ok, true);
  assert.equal(loc(db, id).status, 'matched');
});
