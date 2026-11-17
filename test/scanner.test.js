'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanFolder } = require('../src/core/scanner.js');

function tree(dirs, files = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(root, f), 'x');
  return root;
}
const opts = { ignore: [], collections: [] };
const names = (scan) => scan.entries.map((e) => e.name).sort();

test('direct child folders are entries; files are not; empty flag set', () => {
  const root = tree(['A', 'Empty'], ['A/movie.mkv', 'loose.txt']);
  const scan = scanFolder(root, 'Movies', opts);
  assert.equal(scan.ok, true);
  assert.deepEqual(names(scan), ['A', 'Empty']);
  assert.equal(scan.entries.find((e) => e.name === 'Empty').isEmpty, true);
  assert.equal(scan.entries.find((e) => e.name === 'A').isEmpty, false);
  assert.equal(scan.entries.find((e) => e.name === 'A').relPath, 'Movies/A');
});

test('relPath has no leading slash when the root is the drive root', () => {
  const root = tree(['A']);
  assert.equal(scanFolder(root, '', opts).entries[0].relPath, 'A');
});

test('default and user ignore names are skipped, case-insensitively', () => {
  const root = tree(['$RECYCLE.BIN', 'System Volume Information', 'subtitles', 'Extras', 'Trash', 'Keep']);
  assert.deepEqual(names(scanFolder(root, '', { ...opts, ignore: ['trash'] })), ['Keep']);
});

test('collection folder is opened one level', () => {
  const root = tree(['Marvel/Iron Man', 'Marvel/Thor', 'Solo']);
  const scan = scanFolder(root, 'Movies', { ...opts, collections: ['Movies/Marvel'] });
  assert.deepEqual(names(scan), ['Iron Man', 'Solo', 'Thor']);
  assert.equal(scan.entries.find((e) => e.name === 'Thor').relPath, 'Movies/Marvel/Thor');
});

test('a root that cannot be read gives ok false and no entries', () => {
  const scan = scanFolder('/definitely/not/here', 'x', opts);
  assert.equal(scan.ok, false);
  assert.deepEqual(scan.entries, []);
});

test('an unreadable child folder is skipped and the scan still succeeds', () => {
  const root = tree(['Good', 'Locked']);
  const fsApi = {
    ...fs,
    readdirSync(p, o) {
      if (String(p).endsWith('Locked')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return fs.readdirSync(p, o);
    },
  };
  const scan = scanFolder(root, '', { ...opts, fsApi });
  assert.equal(scan.ok, true);
  assert.deepEqual(names(scan), ['Good']);
});
