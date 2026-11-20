'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { normalizeTag, addTag, removeTag } = require('../src/core/tags.js');

const loc = (db, rel) => Number(db.prepare("INSERT INTO locations(drive_serial, rel_path, folder_name) VALUES('S', ?, ?)").run(rel, rel).lastInsertRowid);
const tagsOf = (db, id) => db.prepare('SELECT tag FROM tags WHERE location_id = ? ORDER BY tag').all(id).map((r) => r.tag);

test('normalizeTag trims, collapses spaces, and refuses empty or over-long text', () => {
  assert.equal(normalizeTag('  ایرانی  '), 'ایرانی');
  assert.equal(normalizeTag('classic   noir'), 'classic noir');
  assert.equal(normalizeTag('   '), null);
  assert.equal(normalizeTag(null), null);
  assert.equal(normalizeTag('x'.repeat(31)), 'too_long');
  assert.equal(normalizeTag('x'.repeat(30)), 'x'.repeat(30));
});

test('addTag tags every given folder once; the same name in another case is the same tag', () => {
  const db = openDb(); const a = loc(db, 'a'); const b = loc(db, 'b');
  addTag(db, [a, b], 'Iranian');
  addTag(db, [a], 'iranian');
  assert.deepEqual([tagsOf(db, a), tagsOf(db, b)], [['Iranian'], ['Iranian']]);
});

test('removeTag removes it case-insensitively from the given folders only', () => {
  const db = openDb(); const a = loc(db, 'a'); const b = loc(db, 'b');
  addTag(db, [a, b], 'Iranian');
  removeTag(db, [a], 'IRANIAN');
  assert.deepEqual([tagsOf(db, a), tagsOf(db, b)], [[], ['Iranian']]);
});
