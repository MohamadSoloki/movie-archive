'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb, getSetting, setSetting } = require('../src/core/db.js');

test('openDb creates all tables', () => {
  const db = openDb();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const n of ['settings', 'drives', 'roots', 'titles', 'locations']) assert.ok(names.includes(n), n);
});

test('getSetting falls back to the default pattern list', () => {
  const db = openDb();
  assert.deepEqual(getSetting(db, 'patterns'), ['{title} {year}*']);
  assert.equal(getSetting(db, 'language'), 'fa');
});

test('setSetting round trips JSON values', () => {
  const db = openDb();
  setSetting(db, 'ignore', ['Trash']);
  assert.deepEqual(getSetting(db, 'ignore'), ['Trash']);
  setSetting(db, 'omdbKey', 'abc');
  assert.equal(getSetting(db, 'omdbKey'), 'abc');
});

test('openDb twice on the same file does not throw', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ma-')), 'a.db');
  openDb(file).close();
  assert.doesNotThrow(() => openDb(file).close());
});

test('new tables exist and translateEmail defaults to empty', () => {
  const db = openDb();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const n of ['episodes', 'translations', 'cache']) assert.ok(names.includes(n), n);
  assert.equal(getSetting(db, 'translateEmail'), '');
});

test('a database made before the new title columns gets them on open', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ma-')), 'old.db');
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec('CREATE TABLE titles(id INTEGER PRIMARY KEY, imdb_id TEXT UNIQUE, mal_id INTEGER UNIQUE, source TEXT, title TEXT, year TEXT, type TEXT, plot TEXT, genres TEXT, rating TEXT, runtime TEXT, actors TEXT, poster_file TEXT, poster_url TEXT)');
  old.close();
  const db = openDb(file);
  const cols = db.prepare('PRAGMA table_info(titles)').all().map((c) => c.name);
  for (const c of ['director', 'awards', 'rated', 'country', 'total_seasons']) assert.ok(cols.includes(c), c);
});

test('a file database uses WAL with normal sync, so a write does not wait for the disk every time', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wal-')), 'a.db');
  const db = openDb(file);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 1);
  db.close();
});

test('the twin lookup of the queue and the per-title joins use indexes, not table scans', () => {
  const db = openDb();
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ');
  assert.match(plan("SELECT title_id FROM locations WHERE id != 1 AND status = 'matched' AND lower(parsed_title) = lower('x') AND parsed_year IS NULL"), /USING INDEX loc_twin/);
  assert.match(plan('SELECT season FROM locations WHERE title_id = 1 AND missing = 0'), /USING INDEX loc_title/);
});
