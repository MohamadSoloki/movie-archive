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
