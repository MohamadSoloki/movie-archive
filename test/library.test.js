'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { refreshDrives } = require('../src/core/drives.js');
const { upsertTitle } = require('../src/core/titles.js');
const { listEntries } = require('../src/core/library.js');

const info = (imdbId, title) => ({ source: 'omdb', imdbId, malId: null, title, year: '2022', type: 'movie', plot: 'p',
  genres: 'Action', rating: '7', runtime: '100 min', actors: 'Someone', posterUrl: null });
let n = 0;
function addLoc(db, o = {}) {
  n += 1;
  const v = { serial: 'S1', title: 'x', year: null, season: null, titleId: null, status: 'pending', empty: 0, missing: 0, guessed: 0, folder: `folder ${n}`, ...o };
  return Number(db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, parsed_year, season, title_id, status, is_empty, missing, guessed)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(v.serial, `Movies/${v.folder}`, v.folder, v.title, v.year, v.season, v.titleId, v.status, v.empty, v.missing, v.guessed).lastInsertRowid);
}

test('one title on two drives is one entry with two locations', () => {
  const db = openDb();
  refreshDrives(db, [{ serial: 'S1', label: 'Films1', root: 'E:\\' }]);
  const t = upsertTitle(db, info('tt1', 'The Batman'), 'tt1.jpg');
  addLoc(db, { titleId: t, status: 'matched', serial: 'S1' });
  addLoc(db, { titleId: t, status: 'matched', serial: 'S2' });
  const entries = listEntries(db);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.deepEqual([e.key, e.title, e.status, e.posterFile], [`t:${t}`, 'The Batman', 'matched', 'tt1.jpg']);
  assert.equal(e.locations.length, 2);
  assert.deepEqual([e.locations[0].driveLabel, e.locations[0].online], ['Films1', true]);
  assert.deepEqual([e.locations[1].driveLabel, e.locations[1].online], ['', false]);
});

test('an unmatched location is its own entry named after the parsed title', () => {
  const db = openDb();
  const id = addLoc(db, { title: 'بتمن', year: '2022', status: 'review', guessed: 1 });
  const [e] = listEntries(db);
  assert.deepEqual([e.key, e.locationId, e.titleId, e.title, e.year, e.status, e.guessed],
    [`l:${id}`, id, null, 'بتمن', '2022', 'review', true]);
});

test('season is kept per location under one series entry', () => {
  const db = openDb();
  const t = upsertTitle(db, info('tt2', 'Breaking Bad'), null);
  addLoc(db, { titleId: t, status: 'matched', season: '01' });
  addLoc(db, { titleId: t, status: 'matched', season: '02' });
  const [e] = listEntries(db);
  assert.deepEqual(e.locations.map((l) => l.season), ['01', '02']);
});

test('empty and missing flags are exposed per location', () => {
  const db = openDb();
  addLoc(db, { empty: 1, missing: 1 });
  const [l] = listEntries(db)[0].locations;
  assert.deepEqual([l.isEmpty, l.missing], [true, true]);
});

test('titles without any location are not listed; entries are sorted by title', () => {
  const db = openDb();
  upsertTitle(db, info('tt9', 'Orphan'), null);
  const b = upsertTitle(db, info('tt3', 'Batman'), null);
  const a = upsertTitle(db, info('tt4', 'Alien'), null);
  addLoc(db, { titleId: b, status: 'matched' });
  addLoc(db, { titleId: a, status: 'matched' });
  assert.deepEqual(listEntries(db).map((e) => e.title), ['Alien', 'Batman']);
});
