'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { refreshDrives } = require('../src/core/drives.js');
const { syncScan } = require('../src/core/sync.js');

const P = ['{title} {year}*'];
const entry = (name, rel = 'Movies', isEmpty = false) => ({ name, relPath: `${rel}/${name}`, isEmpty });
const scanOf = (...entries) => ({ ok: true, entries });
const args = (scan, extra = {}) => ({ driveSerial: 'S1', rootRel: 'Movies', scan, patterns: P, ...extra });
const rows = (db) => db.prepare('SELECT * FROM locations ORDER BY id').all();

test('first scan inserts a parsed pending location', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('batman 2022'))));
  const [r] = rows(db);
  assert.deepEqual([r.parsed_title, r.parsed_year, r.status, r.guessed, r.missing], ['batman', '2022', 'pending', 0, 0]);
  assert.equal(r.rel_path, 'Movies/batman 2022');
});

test('auto-parsed names are flagged guessed', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('Some Movie 1080p'))));
  assert.equal(rows(db)[0].guessed, 1);
});

test('folder that disappears is marked missing, not deleted; refound clears it', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('a 2000'), entry('b 2001'))));
  syncScan(db, args(scanOf(entry('a 2000'))));
  assert.deepEqual(rows(db).map((r) => r.missing), [0, 1]);
  syncScan(db, args(scanOf(entry('a 2000'), entry('b 2001'))));
  assert.deepEqual(rows(db).map((r) => r.missing), [0, 0]);
});

test('scan with ok false changes nothing (unreadable root does not mark everything missing)', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('a 2000'))));
  syncScan(db, args({ ok: false, entries: [] }));
  assert.equal(rows(db)[0].missing, 0);
});

test('unreadable folders and everything under them are never marked missing', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('a 2000'), entry('b 2001'))));
  db.prepare("INSERT INTO locations(drive_serial, rel_path, folder_name) VALUES('S1', 'Movies/Marvel/Thor', 'Thor')").run();
  syncScan(db, args({ ok: true, entries: [entry('a 2000')], unreadable: ['Movies/b 2001', 'Movies/Marvel'] }));
  assert.deepEqual(rows(db).map((r) => r.missing), [0, 0, 0]);
});

test('a review location whose parse changes after a pattern change goes back to pending', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('batman (2022)')), { patterns: ['{title}'] }));
  db.prepare("UPDATE locations SET status = 'review'").run();
  syncScan(db, args(scanOf(entry('batman (2022)')), { patterns: ['{title}'] }));
  assert.equal(rows(db)[0].status, 'review');
  syncScan(db, args(scanOf(entry('batman (2022)'))));
  assert.deepEqual([rows(db)[0].parsed_title, rows(db)[0].parsed_year, rows(db)[0].status], ['batman', '2022', 'pending']);
});

test('missing only applies under the scanned root', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('a 2000'))));
  syncScan(db, { driveSerial: 'S1', rootRel: 'Anime', scan: scanOf(entry('x 2010', 'Anime')), patterns: P });
  syncScan(db, { driveSerial: 'S1', rootRel: 'Anime', scan: scanOf(), patterns: P });
  const byPath = Object.fromEntries(rows(db).map((r) => [r.rel_path, r.missing]));
  assert.deepEqual(byPath, { 'Movies/a 2000': 0, 'Anime/x 2010': 1 });
});

test('empty flag follows the folder', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('a 2000', 'Movies', true))));
  assert.equal(rows(db)[0].is_empty, 1);
  syncScan(db, args(scanOf(entry('a 2000', 'Movies', false))));
  assert.equal(rows(db)[0].is_empty, 0);
});

test('rescan re-parses pending rows with new patterns but never pinned or matched ones', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('batman 2022'), entry('joker 2019'))));
  db.prepare("UPDATE locations SET pinned = 1, status = 'matched', title_id = 7, parsed_title = 'Fixed' WHERE folder_name = 'joker 2019'").run();
  syncScan(db, args(scanOf(entry('batman 2022'), entry('joker 2019')), { patterns: ['{title}'] }));
  const [bat, jok] = rows(db);
  assert.equal(bat.parsed_title, 'batman 2022');
  assert.deepEqual([jok.parsed_title, jok.title_id, jok.status], ['Fixed', 7, 'matched']);
});

test('same serial with a new drive letter keeps one location and nothing missing', () => {
  const db = openDb();
  refreshDrives(db, [{ serial: 'S1', label: 'A', root: 'E:\\' }]);
  syncScan(db, args(scanOf(entry('a 2000'))));
  refreshDrives(db, [{ serial: 'S1', label: 'A', root: 'G:\\' }]);
  syncScan(db, args(scanOf(entry('a 2000'))));
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].missing, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM drives').get().c, 1);
});

test('a season entry stores its season and the show title; the folder name stays', () => {
  const db = openDb();
  const e = { name: 'Mentalist S01', relPath: 'Movies/Mentalist S01', isEmpty: false, season: '01', titleName: 'Mentalist' };
  syncScan(db, args(scanOf(e)));
  const r = rows(db)[0];
  assert.deepEqual([r.parsed_title, r.season, r.folder_name], ['Mentalist', '01', 'Mentalist S01']);
});

test('the year of a parent folder name reaches the parsed year', () => {
  const db = openDb();
  const e = { name: 'S01', relPath: 'Movies/The Mentalist (2008)/S01', isEmpty: false, season: '01', titleName: 'The Mentalist (2008)' };
  syncScan(db, args(scanOf(e)));
  assert.deepEqual([rows(db)[0].parsed_title, rows(db)[0].parsed_year], ['The Mentalist', '2008']);
});

test('rescan keeps matched rows untouched, adds only new folders and reports how many', () => {
  const db = openDb();
  assert.equal(syncScan(db, args(scanOf(entry('batman 2022'), entry('dune 2021')))), 2);
  db.prepare("UPDATE locations SET status = 'matched', title_id = 7, pinned = 1, parsed_title = 'The Batman' WHERE parsed_title = 'batman'").run();
  const before = rows(db).find((r) => r.parsed_title === 'The Batman');
  assert.equal(syncScan(db, args(scanOf(entry('batman 2022'), entry('dune 2021'), entry('alien 1979')))), 1);
  const after = rows(db);
  assert.equal(after.length, 3);
  assert.deepEqual(after.find((r) => r.id === before.id), before);
  assert.deepEqual(after.filter((r) => r.status === 'pending').map((r) => r.parsed_title).sort(), ['alien', 'dune']);
  assert.equal(syncScan(db, args(scanOf(entry('batman 2022'), entry('dune 2021'), entry('alien 1979')))), 0);
});

test('a single-folder root marks only its own folder missing, never its siblings', () => {
  const db = openDb();
  syncScan(db, args(scanOf(entry('batman 2022'), entry('dune 2021'))));
  syncScan(db, { driveSerial: 'S1', rootRel: 'Movies/Batman 2022', scan: scanOf(), patterns: P });
  assert.deepEqual(rows(db).map((r) => [r.parsed_title, r.missing]), [['batman', 1], ['dune', 0]]);
});
