'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffWish, saveWish } = require('../src/core/lists.js');
const { openDb } = require('../src/core/db.js');

test('diffWish: films the customer newly picked are added, films they dropped are removed', () => {
  assert.deepEqual(diffWish({ have: ['a', 'b', 'c'], fromPhone: ['a', 'b'], wanted: ['b', 'd'] }), { add: ['d'], remove: ['a'] });
});

test('diffWish: a film the owner put in the list by hand is never removed, only phone films are', () => {
  assert.deepEqual(diffWish({ have: ['a', 'own'], fromPhone: ['a'], wanted: [] }), { add: [], remove: ['a'] });
});

test('diffWish: nothing changes when the list already matches; repeats count once', () => {
  assert.deepEqual(diffWish({ have: ['a', 'b'], fromPhone: ['a', 'b'], wanted: ['b', 'a', 'a'] }), { add: [], remove: [] });
  assert.deepEqual(diffWish({ have: [], fromPhone: [], wanted: ['x', 'x'] }), { add: ['x'], remove: [] });
});

test('diffWish: a film that was removed by the owner and is still wanted comes back only when it is new to the phone side', () => {
  // owner deleted "a" from the list; the customer still has it selected -> it is not re-added behind the owner's back
  assert.deepEqual(diffWish({ have: ['b'], fromPhone: ['a', 'b'], wanted: ['a', 'b'] }), { add: [], remove: [] });
});

test('one wish per browser keeps its reference, replaces choices, and accepts retries and an empty edit', () => {
  const db = openDb();
  const wish = (editKey, keys) => ({ name: 'Ali', phone: '', note: '', editKey, items: keys.map((key) => ({ key })) });
  const key = 'ab'.repeat(32);
  assert.equal(saveWish(db, wish(key, []), 100, 2), null);
  const id = saveWish(db, wish(key, ['a', 'b']), 100, 2);
  const other = saveWish(db, wish('cd'.repeat(32), ['private-to-other']), 101, 2);
  assert.notEqual(id, other);
  assert.equal(saveWish(db, wish('ef'.repeat(32), ['over-limit']), 102, 2), 0);
  assert.equal(saveWish(db, wish(key, ['b', 'c']), 103, 2), id);
  assert.equal(saveWish(db, wish(key, ['b', 'c']), 104, 2), id);
  const row = db.prepare('SELECT * FROM wishes WHERE id = ?').get(id);
  assert.equal(row.created, 100);
  assert.equal(row.updated, 103);
  assert.deepEqual(JSON.parse(row.items), [{ key: 'b' }, { key: 'c' }]);
  assert.notEqual(row.edit_key_hash, key);
  assert.equal(saveWish(db, wish(key, []), 103, 2), id);
  assert.deepEqual(db.prepare('SELECT items, updated FROM wishes WHERE id = ?').get(id).items, '[]');
  assert.equal(db.prepare('SELECT updated FROM wishes WHERE id = ?').get(id).updated, 104);
  assert.equal(db.prepare('SELECT items FROM wishes WHERE id = ?').get(other).items, '[{"key":"private-to-other"}]');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wishes').get().n, 2);
  db.close();
});
