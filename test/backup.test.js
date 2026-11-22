'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, setSetting, getSetting } = require('../src/core/db.js');
const { exportData, importData } = require('../src/core/backup.js');
const orders = require('../src/core/orders.js');

function seed() {
  const db = openDb();
  db.prepare("INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, status) VALUES('D1','Movies/A','A','A','pending')").run();
  const id = db.prepare('SELECT id FROM locations').get().id;
  db.prepare('INSERT INTO tags(location_id, tag) VALUES(?, ?)').run(id, 'Iranian');
  db.prepare('INSERT INTO aliases(location_id, alias) VALUES(?, ?)').run(id, 'الف');
  db.prepare('INSERT INTO reminders(title, key, weekday, time, episode, due, enabled) VALUES(?,?,?,?,?,?,?)').run('Show', 't:1', 2, '20:00', 3, 99, 1);
  db.prepare("INSERT INTO copies(name, target, created, state) VALUES('Flash','F:\\\\Flash', 5, 'ok')").run();
  db.prepare("INSERT INTO copy_files(copy_id, rel, size, sha, title, drive_serial, src_rel) VALUES(1,'A/a.mkv',10,'abc','A','D1','Movies/A')").run();
  orders.recordOrder(db, { customer: 'Ali', phone: '09', items: [{ ref: 'tt1', title: 'A', year: '2020', kind: 'movie', detail: '' }], bytes: 7, price: 100 }, 50);
  orders.addRequest(db, 'Dune 2', 60);
  orders.addRequest(db, 'Dune 2', 61);
  setSetting(db, 'language', 'en');
  setSetting(db, 'omdbKey', 'SECRET');
  setSetting(db, 'copyLists', [{ id: 'x', name: 'L', items: [] }]);
  return db;
}

test('export holds the owner data keyed by drive and folder, never the OMDb key', () => {
  const data = exportData(seed(), { now: 123 });
  assert.equal(data.format, 'movie-archive-backup');
  assert.equal(data.exportedAt, 123);
  assert.deepEqual(data.tags, [{ driveSerial: 'D1', relPath: 'Movies/A', tag: 'Iranian' }]);
  assert.deepEqual(data.aliases, [{ driveSerial: 'D1', relPath: 'Movies/A', alias: 'الف' }]);
  assert.equal(JSON.stringify(data).includes('SECRET'), false);
  assert.equal(data.settings.language, 'en');
});

test('import into a fresh database restores them, matching folders by drive and path', () => {
  const data = JSON.parse(JSON.stringify(exportData(seed(), { now: 1 })));
  const db = openDb();
  db.prepare("INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, status) VALUES('D1','Movies/A','A','A','pending')").run();
  setSetting(db, 'omdbKey', 'MINE');
  const r = importData(db, data);
  assert.deepEqual([r.tags, r.aliases, r.reminders, r.copies, r.skipped], [1, 1, 1, 1, 0]);
  assert.deepEqual(db.prepare('SELECT tag FROM tags').all().map((x) => x.tag), ['Iranian']);
  assert.equal(getSetting(db, 'language'), 'en');
  assert.equal(getSetting(db, 'omdbKey'), 'MINE');
  assert.deepEqual(getSetting(db, 'copyLists'), [{ id: 'x', name: 'L', items: [] }]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM copy_files').get().c, 1);
  assert.deepEqual(orders.listOrders(db).map((o) => [o.customer, o.price, o.items.map((i) => i.ref)]), [['Ali', 100, ['tt1']]]);
  assert.deepEqual(orders.listRequests(db).map((r) => [r.name, r.count]), [['Dune 2', 2]]);
  assert.deepEqual([r.orders, r.requests], [1, 1]);
  // twice is harmless
  importData(db, data);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tags').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reminders').get().c, 1);
  assert.equal(orders.listOrders(db).length, 1);
  assert.equal(orders.listRequests(db)[0].count, 2);
});

test('tags of a folder this machine does not know are counted as skipped; a foreign file is refused', () => {
  const data = JSON.parse(JSON.stringify(exportData(seed(), { now: 1 })));
  const db = openDb();
  assert.equal(importData(db, data).skipped, 2);
  assert.throws(() => importData(db, { format: 'nope' }), /not_a_backup/);
  assert.throws(() => importData(db, null), /not_a_backup/);
});
