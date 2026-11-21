'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require('../src/core/db.js');
const { saveCopy, listCopies, copyFiles, markChecked, removeCopy, problemsByTitle } = require('../src/core/copies.js');

const T = path.join(path.sep, 'out', 'claude');
const f = (rel, over = {}) => ({ rel, size: 10, sha: 'h', title: 'Film', driveSerial: 'S1', srcRel: `Movies/${rel}`, ...over });

test('saveCopy stores a named copy with its files; listCopies shows count and bytes, newest first', () => {
  const db = openDb();
  const a = saveCopy(db, { name: 'claude', target: T, files: [f('a.mkv'), f('b.srt', { size: 5 })] }, 100);
  const b = saveCopy(db, { name: 'flash', target: path.join(path.sep, 'out', 'flash'), files: [f('c.mkv')] }, 200);
  const list = listCopies(db);
  assert.deepEqual(list.map((c) => [c.id, c.name, c.files, c.bytes, c.state]), [[b, 'flash', 1, 10, null], [a, 'claude', 2, 15, null]]);
  assert.equal(copyFiles(db, a).length, 2);
});

test('copying into the same target again adds to the same copy and keeps a known hash when the new run has none', () => {
  const db = openDb();
  const a = saveCopy(db, { name: 'claude', target: T, files: [f('a.mkv')] }, 100);
  const again = saveCopy(db, { name: 'claude', target: T, files: [f('a.mkv', { sha: null }), f('b.mkv', { sha: 'x' })] }, 300);
  assert.equal(again, a);
  assert.equal(listCopies(db).length, 1);
  const files = Object.fromEntries(copyFiles(db, a).map((x) => [x.rel, x.sha]));
  assert.deepEqual(files, { 'a.mkv': 'h', 'b.mkv': 'x' });
});

test('markChecked stores the result and time; new files reset an old verdict', () => {
  const db = openDb();
  const a = saveCopy(db, { name: 'claude', target: T, files: [f('a.mkv')] }, 100);
  markChecked(db, a, 'ok', 150);
  assert.deepEqual([listCopies(db)[0].state, listCopies(db)[0].checked], ['ok', 150]);
  saveCopy(db, { name: 'claude', target: T, files: [f('b.mkv')] }, 200);
  assert.equal(listCopies(db)[0].state, null);
});

test('removeCopy deletes the record and its files, nothing else', () => {
  const db = openDb();
  const a = saveCopy(db, { name: 'claude', target: T, files: [f('a.mkv')] }, 100);
  const b = saveCopy(db, { name: 'flash', target: path.join(path.sep, 'out', 'flash'), files: [f('c.mkv')] }, 100);
  removeCopy(db, a);
  assert.deepEqual(listCopies(db).map((c) => c.id), [b]);
  assert.equal(copyFiles(db, a).length, 0);
  assert.equal(copyFiles(db, b).length, 1);
});

test('problemsByTitle groups bad files under the film or series they belong to', () => {
  const files = [f('Show/S1/e1.mkv', { title: 'Show' }), f('Show/S1/e2.mkv', { title: 'Show' }), f('Film.mkv', { title: 'Film' })];
  const dest = (rel) => path.join(T, rel);
  const out = problemsByTitle(files, T, [
    { dest: dest('Show/S1/e2.mkv'), reason: 'hash' }, { dest: dest('Show/S1/e1.mkv'), reason: 'missing' }, { dest: dest('Film.mkv'), reason: 'size' },
  ]);
  assert.deepEqual(out, [
    { title: 'Show', files: [{ rel: 'Show/S1/e1.mkv', reason: 'missing' }, { rel: 'Show/S1/e2.mkv', reason: 'hash' }] },
    { title: 'Film', files: [{ rel: 'Film.mkv', reason: 'size' }] },
  ]);
});
