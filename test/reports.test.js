'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { upsertTitle } = require('../src/core/titles.js');
const { listEntries } = require('../src/core/library.js');
const { singleDrive } = require('../src/core/reports.js');

const info = (id, title) => ({ source: 'omdb', imdbId: id, malId: null, title, year: '2020', type: 'movie', plot: 'p', genres: 'Drama', rating: '7', runtime: '1', actors: 'a', posterUrl: null });

test('films kept on one drive only are listed per drive; films on two drives or gone are not', () => {
  const db = openDb();
  db.prepare("INSERT INTO drives(serial, label, root, online) VALUES('D1','Big','D:\\\\',1),('D2','Small','E:\\\\',1)").run();
  const loc = (serial, rel, titleId, missing = 0) => db.prepare(
    "INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, title_id, status, missing) VALUES(?,?,?,?,?,'matched',?)").run(serial, rel, rel, rel, titleId, missing);
  const a = upsertTitle(db, info('tt1', 'Both'), null); loc('D1', 'a1', a); loc('D2', 'a2', a);
  const b = upsertTitle(db, info('tt2', 'Only Big'), null); loc('D1', 'b1', b);
  const c = upsertTitle(db, info('tt3', 'Two Folders Same Drive'), null); loc('D2', 'c1', c); loc('D2', 'c2', c);
  const d = upsertTitle(db, info('tt4', 'Gone'), null); loc('D1', 'd1', d, 1);
  const e = upsertTitle(db, info('tt5', 'Copy Gone'), null); loc('D1', 'e1', e); loc('D2', 'e2', e, 1);
  const r = singleDrive(listEntries(db));
  assert.deepEqual(r.map((g) => [g.driveSerial, g.driveLabel, g.items.map((i) => i.title)]),
    [['D1', 'Big', ['Copy Gone', 'Only Big']], ['D2', 'Small', ['Two Folders Same Drive']]]);
});

test('the printable catalog lists each film once, under its first genre, in name order; no genre goes last', () => {
  const { catalogByGenre } = require('../src/core/reports.js');
  const db = openDb();
  db.prepare("INSERT INTO drives(serial, label, root, online) VALUES('D1','Big','D:\\\\',1)").run();
  const add = (id, title, genres, folder, type = 'movie') => {
    const tid = upsertTitle(db, { ...info(id, title), genres, type }, null);
    db.prepare("INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, title_id, status) VALUES('D1',?,?,?,?,'matched')").run(folder, folder, title, tid);
  };
  add('t1', 'Zed', 'Action, Drama', 'Zed 1080p');
  add('t2', 'Alpha', 'Action', 'Alpha دوبله');
  add('t3', 'Beta', 'Comedy', 'Beta');
  add('t4', 'Nameless', '', 'Nameless', 'series');
  db.prepare("INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, status) VALUES('D1','mystery','mystery','mystery','pending')").run();
  const r = catalogByGenre(listEntries(db));
  assert.deepEqual(r.map((g) => [g.genre, g.items.map((i) => i.title)]),
    [['Action', ['Alpha', 'Zed']], ['Comedy', ['Beta']], [null, ['mystery', 'Nameless']]]);
  assert.deepEqual(r[0].items[0].badges, ['dub']);
  assert.deepEqual(r[0].items[1].badges, ['1080p']);
});

test('duplicates: a film or season with two usable copies is listed with each copy and the space freed by keeping only the biggest', () => {
  const { duplicates } = require('../src/core/reports.js');
  const db = openDb();
  db.prepare("INSERT INTO drives(serial, label, root, online) VALUES('D1','Big','D:\\\\',1),('D2','Small','E:\\\\',1),('D3','Off','F:\\\\',0)").run();
  const loc = (serial, rel, titleId, extra = {}) => db.prepare(
    "INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, title_id, status, missing, season) VALUES(?,?,?,?,?,'matched',?,?)")
    .run(serial, rel, rel, rel, titleId, extra.missing ?? 0, extra.season ?? null);
  const film = upsertTitle(db, info('tt1', 'Twice'), null); loc('D1', 'Twice 1080p', film); loc('D2', 'Twice 720p', film);
  const three = upsertTitle(db, info('tt2', 'Thrice'), null); loc('D1', 't1', three); loc('D1', 't2', three); loc('D2', 't3', three);
  const single = upsertTitle(db, info('tt3', 'Once'), null); loc('D1', 'o1', single);
  const gone = upsertTitle(db, info('tt4', 'Copy Gone'), null); loc('D1', 'g1', gone); loc('D2', 'g2', gone, { missing: 1 });
  const off = upsertTitle(db, info('tt5', 'Copy On Unplugged Drive'), null); loc('D1', 'u1', off); loc('D3', 'u2', off); // size unknown: listed, not counted
  const show = upsertTitle(db, { ...info('tt6', 'Show'), type: 'series' }, null);
  loc('D1', 'Show/S01', show, { season: '1' }); loc('D2', 'Show/S01', show, { season: '1' }); loc('D1', 'Show/S02', show, { season: '2' }); // season 2 once: fine
  const sizes = { 'D1:Twice 1080p': 8000, 'D2:Twice 720p': 3000, 'D1:t1': 5000, 'D1:t2': 4000, 'D2:t3': 6000, 'D1:Show/S01': 900, 'D2:Show/S01': 900, 'D1:u1': 70 };
  const r = duplicates(listEntries(db), (l) => sizes[`${l.driveSerial}:${l.relPath}`] ?? null);
  assert.deepEqual(r.groups.map((g) => [g.title, g.season, g.copies.length, g.reclaim]),
    [['Thrice', null, 3, 9000], ['Twice', null, 2, 3000], ['Show', 1, 2, 900], ['Copy On Unplugged Drive', null, 2, 0]]);
  assert.deepEqual(r.groups[1].copies.map((c) => [c.driveLabel, c.relPath, c.bytes, c.badges]), [['Big', 'Twice 1080p', 8000, ['1080p']], ['Small', 'Twice 720p', 3000, ['720p']]]); // biggest first
  assert.equal(r.groups[3].copies.find((c) => c.driveLabel === 'Off').bytes, null);
  assert.deepEqual([r.reclaim, r.count], [12900, 4]);
  assert.deepEqual(duplicates([], () => 0), { groups: [], reclaim: 0, count: 0 });
});
