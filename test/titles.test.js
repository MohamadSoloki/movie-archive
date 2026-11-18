'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { upsertTitle } = require('../src/core/titles.js');

const INFO = {
  source: 'omdb', imdbId: 'tt1', malId: null, title: 'T', year: '2022', type: 'movie', plot: 'p', genres: 'Action',
  rating: '7', runtime: '1 min', actors: 'a', posterUrl: null,
  director: 'D', awards: 'A', rated: 'R', country: 'IR', totalSeasons: 3,
};

test('upsertTitle stores director, awards, rated, country and total_seasons', () => {
  const db = openDb();
  const id = upsertTitle(db, INFO, null);
  const r = db.prepare('SELECT director, awards, rated, country, total_seasons FROM titles WHERE id = ?').get(id);
  assert.deepEqual({ ...r }, { director: 'D', awards: 'A', rated: 'R', country: 'IR', total_seasons: 3 });
  upsertTitle(db, { ...INFO, director: 'E' }, null);
  assert.equal(db.prepare('SELECT director FROM titles WHERE id = ?').get(id).director, 'E');
});

test('older info objects without the new fields still store', () => {
  const db = openDb();
  const { director, awards, rated, country, totalSeasons, ...old } = INFO;
  const id = upsertTitle(db, old, null);
  assert.equal(db.prepare('SELECT director FROM titles WHERE id = ?').get(id).director, null);
});
