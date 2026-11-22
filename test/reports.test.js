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
