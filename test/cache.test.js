'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { cached, getCache, putCache, searchCached } = require('../src/core/cache.js');

test('cached runs the loader once per key and stores falsy values like []', async () => {
  const db = openDb();
  let n = 0;
  const loader = async () => { n += 1; return []; };
  assert.deepEqual(await cached(db, 'k', loader), []);
  assert.deepEqual(await cached(db, 'k', loader), []);
  assert.equal(n, 1);
});

test('a throwing loader stores nothing', async () => {
  const db = openDb();
  await assert.rejects(cached(db, 'bad', async () => { throw new Error('x'); }));
  assert.equal(getCache(db, 'bad'), undefined);
});

test('putCache then getCache round trips JSON', () => {
  const db = openDb();
  putCache(db, 'a', { x: [1, 2] });
  assert.deepEqual(getCache(db, 'a'), { x: [1, 2] });
});

test('searchCached ignores case and asks OMDb once', async () => {
  const db = openDb();
  let calls = 0;
  const omdb = { search: async () => { calls += 1; return [{ imdbId: 'tt1' }]; } };
  await searchCached(db, omdb, 'Batman', '2022');
  assert.deepEqual(await searchCached(db, omdb, 'batman', '2022'), [{ imdbId: 'tt1' }]);
  assert.equal(calls, 1);
  await searchCached(db, omdb, 'batman', null);
  assert.equal(calls, 2);
});
