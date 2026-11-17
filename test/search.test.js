'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { upsertTitle } = require('../src/core/titles.js');
const { createSearch } = require('../src/core/search.js');

const info = (imdbId, title) => ({ source: 'omdb', imdbId, malId: null, title, year: '2022', type: 'movie', plot: 'p',
  genres: 'Action', rating: '7', runtime: '100 min', actors: 'Robert Pattinson', posterUrl: null });
let n = 0;
function addLoc(db, { titleId = null, folder, title = 'x' }) {
  n += 1;
  db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, title_id, status)
    VALUES('S1', ?, ?, ?, ?, ?)`).run(`Movies/${folder}${n}`, folder, title, titleId, titleId ? 'matched' : 'pending');
}
function seed() {
  const db = openDb();
  const bat = upsertTitle(db, info('tt1', 'The Batman'), null);
  addLoc(db, { titleId: bat, folder: 'بتمن 2022' });
  const alien = upsertTitle(db, { ...info('tt2', 'Alien'), actors: 'Sigourney Weaver', genres: 'Horror' }, null);
  addLoc(db, { titleId: alien, folder: 'alien 1979' });
  return db;
}

test('a typo still finds the title', () => {
  const s = createSearch(seed());
  assert.equal(s.query('batmn')[0].title, 'The Batman');
});

test('a persian query finds an entry through its folder name', () => {
  const s = createSearch(seed());
  assert.equal(s.query('بتمن')[0].title, 'The Batman');
});

test('actors are searchable', () => {
  const s = createSearch(seed());
  assert.equal(s.query('Weaver')[0].title, 'Alien');
});

test('blank query returns everything and nonsense returns nothing', () => {
  const s = createSearch(seed());
  assert.equal(s.query('   ').length, 2);
  assert.deepEqual(s.query('qqqqqqqq'), []);
});

test('invalidate makes new data searchable', () => {
  const db = seed();
  const s = createSearch(db);
  assert.equal(s.query('matrix').length, 0);
  const t = upsertTitle(db, info('tt3', 'The Matrix'), null);
  addLoc(db, { titleId: t, folder: 'the matrix 1999' });
  s.invalidate();
  assert.equal(s.query('matrix')[0].title, 'The Matrix');
});
