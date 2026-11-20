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

test('entries carry genre list, extra facts, kind and add order', () => {
  const db = openDb();
  const movie = upsertTitle(db, { ...info('tt7', 'Heat'), genres: 'Action, Crime', director: 'Michael Mann', awards: '3 wins', rated: 'R', country: 'USA' }, null);
  const show = upsertTitle(db, { ...info('tt8', 'Lost'), type: 'series', totalSeasons: 6 }, null);
  const odd = upsertTitle(db, { ...info('tt9', 'Naruto'), type: 'anime', imdbId: null, malId: 5, source: 'jikan' }, null);
  const first = addLoc(db, { titleId: movie, status: 'matched' });
  addLoc(db, { titleId: movie, status: 'matched', serial: 'S2' });
  addLoc(db, { titleId: show, status: 'matched' });
  addLoc(db, { titleId: odd, status: 'matched' });
  addLoc(db, { title: 'unknown show', season: '02' });
  addLoc(db, { title: 'unknown film' });
  const by = Object.fromEntries(listEntries(db).map((e) => [e.title, e]));
  const h = by.Heat;
  assert.deepEqual([h.imdbId, h.genreList, h.director, h.awards, h.rated, h.country, h.kind, h.addedOrder],
    ['tt7', ['Action', 'Crime'], 'Michael Mann', '3 wins', 'R', 'USA', 'movie', first]);
  assert.deepEqual([by.Lost.kind, by.Lost.totalSeasons, by.Naruto.kind], ['series', 6, 'other']);
  assert.deepEqual([by['unknown show'].kind, by['unknown film'].kind, by['unknown film'].genreList, by['unknown film'].imdbId], ['series', 'movie', [], null]);
});

test('a folder that groups two or more titles is a collection entry listing its members', () => {
  const db = openDb();
  refreshDrives(db, [{ serial: 'S1', label: 'Films1', root: 'E:\\' }]);
  const a = upsertTitle(db, info('tt11', 'Batman Begins'), 'tt11.jpg');
  const b = upsertTitle(db, info('tt12', 'The Dark Knight'), null);
  const inPack = (id) => db.prepare("UPDATE locations SET collection = 'Movies/Batman Trilogy' WHERE id = ?").run(id);
  inPack(addLoc(db, { titleId: a, status: 'matched' }));
  inPack(addLoc(db, { titleId: b, status: 'matched' }));
  inPack(addLoc(db, { title: 'unknown third', status: 'review' }));
  const lone = upsertTitle(db, info('tt13', 'Alone'), null);
  db.prepare("UPDATE locations SET collection = 'Movies/Solo' WHERE id = ?").run(addLoc(db, { titleId: lone, status: 'matched' }));
  const all = listEntries(db);
  const c = all.find((e) => e.kind === 'collection');
  assert.equal(all.filter((e) => e.kind === 'collection').length, 1);
  assert.deepEqual([c.title, c.posterFile, c.collection.online, c.collection.relPath, c.collection.missing], ['Batman Trilogy', 'tt11.jpg', true, 'Movies/Batman Trilogy', false]);
  assert.deepEqual(c.members.map((m) => m.title).sort(), ['Batman Begins', 'The Dark Knight', 'unknown third']);
  assert.equal(all.length, 5); // 4 titles/unmatched + the collection
});

test('attention: verified is ok, a guess is guess, anything unsure or broken is problem', () => {
  const db = openDb();
  const t = (id) => upsertTitle(db, info(id, `T ${id}`), null);
  addLoc(db, { titleId: t('tt21'), status: 'matched' });
  addLoc(db, { titleId: t('tt22'), status: 'matched', guessed: 1 });
  addLoc(db, { titleId: t('tt23'), status: 'matched', empty: 1 });
  addLoc(db, { titleId: t('tt24'), status: 'matched', missing: 1 });
  const both = t('tt25');
  addLoc(db, { titleId: both, status: 'matched', missing: 1 });
  addLoc(db, { titleId: both, status: 'matched', serial: 'S2' });
  addLoc(db, { title: 'review me', status: 'review' });
  addLoc(db, { title: 'not yet', status: 'pending' });
  addLoc(db, { titleId: t('tt26'), status: 'matched', guessed: 1, empty: 1 });
  const by = Object.fromEntries(listEntries(db).map((e) => [e.title, e.attention]));
  assert.deepEqual(by, { 'T tt21': 'ok', 'T tt22': 'guess', 'T tt23': 'problem', 'T tt24': 'problem', 'T tt25': 'ok',
    'review me': 'problem', 'not yet': 'problem', 'T tt26': 'problem' });
});

test('reasonOf names why an entry has a dot, in the order the detail view lists its flags', () => {
  const { reasonOf } = require('../src/core/library.js');
  const l = (o = {}) => ({ missing: false, isEmpty: false, ...o });
  assert.equal(reasonOf({ attention: 'ok', status: 'matched', locations: [l()] }), null);
  assert.equal(reasonOf({ attention: 'guess', status: 'matched', locations: [l()] }), 'guessed');
  assert.equal(reasonOf({ attention: 'problem', status: 'matched', locations: [l({ missing: true })] }), 'missing');
  assert.equal(reasonOf({ attention: 'problem', status: 'review', locations: [l()] }), 'review');
  assert.equal(reasonOf({ attention: 'problem', status: 'pending', locations: [l()] }), 'pending');
  assert.equal(reasonOf({ attention: 'problem', status: 'matched', guessed: true, locations: [l({ isEmpty: true })] }), 'empty');
});

test('userTags: the manual tags of every folder of the entry, once each, on matched and unmatched entries', () => {
  const db = openDb();
  const t = upsertTitle(db, info('tt1', 'The Batman'), null);
  const a = addLoc(db, { titleId: t, status: 'matched', serial: 'S1' });
  const b = addLoc(db, { titleId: t, status: 'matched', serial: 'S2' });
  const lone = addLoc(db, { title: 'بتمن', status: 'review' });
  const ins = db.prepare('INSERT INTO tags(location_id, tag) VALUES(?, ?)');
  ins.run(a, 'Iranian'); ins.run(b, 'iranian'); ins.run(b, 'Classic'); ins.run(lone, 'ایرانی');
  const by = Object.fromEntries(listEntries(db).map((e) => [e.key, e]));
  assert.deepEqual(by[`t:${t}`].userTags, ['Classic', 'Iranian']);
  assert.deepEqual(by[`l:${lone}`].userTags, ['ایرانی']);
});

test('entries without tags have an empty list, and so does a collection', () => {
  const db = openDb();
  const t1 = upsertTitle(db, info('tt1', 'A'), null); const t2 = upsertTitle(db, info('tt2', 'B'), null);
  const a = addLoc(db, { titleId: t1, status: 'matched' }); addLoc(db, { titleId: t2, status: 'matched' });
  db.prepare("UPDATE locations SET collection = 'Movies/Pack'").run();
  db.prepare("INSERT INTO tags(location_id, tag) VALUES(?, 'Iranian')").run(a);
  const all = listEntries(db);
  assert.ok(all.some((e) => e.kind === 'collection'));
  assert.deepEqual(all.filter((e) => e.kind === 'collection').map((e) => e.userTags), [[]]);
  assert.deepEqual(all.find((e) => e.title === 'B').userTags, []);
});
