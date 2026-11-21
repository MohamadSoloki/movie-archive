'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanName, isInside, pickLocations, treeSize, copyTree } = require('../src/core/transfer.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'));
const put = (p, bytes) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(bytes, 1)); };

test('cleanName accepts a normal or Persian folder name and refuses unsafe ones', () => {
  assert.equal(cleanName('  claude '), 'claude');
  assert.equal(cleanName('فیلم های ایرانی'), 'فیلم های ایرانی');
  for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*', 'a?', 'a"', 'a<', 'a|', 'x.', 'x'.repeat(101)]) assert.equal(cleanName(bad), null, bad);
});

test('isInside is true for the folder itself and anything below it, never for a sibling with the same prefix', () => {
  const a = path.join(path.sep, 'media', 'Movies');
  assert.equal(isInside(a, a), true);
  assert.equal(isInside(a, path.join(a, 'x', 'y')), true);
  assert.equal(isInside(a, path.join(path.sep, 'media', 'Movies2')), false);
  assert.equal(isInside(a, path.join(path.sep, 'media')), false);
  assert.equal(isInside(a, path.join(path.sep, 'media', 'movies', 'x')), true); // Windows paths ignore case
});

const loc = (o) => ({ id: 1, driveSerial: 'A', online: true, missing: false, isEmpty: false, season: null, relPath: 'M/x', ...o });

test('pickLocations takes one usable copy of a movie and prefers one that is not on the destination drive', () => {
  const same = loc({ id: 1, driveSerial: 'A' });
  const other = loc({ id: 2, driveSerial: 'B' });
  const r = pickLocations([same, other], 'A');
  assert.deepEqual(r.picks.map((l) => l.id), [2]);
  assert.deepEqual(pickLocations([same], 'A').picks.map((l) => l.id), [1]);
});

test('pickLocations skips offline, missing and empty copies and says why', () => {
  assert.deepEqual(pickLocations([loc({ online: false })], 'Z'), { picks: [], reason: 'offline' });
  assert.deepEqual(pickLocations([loc({ missing: true })], 'Z'), { picks: [], reason: 'missing' });
  assert.deepEqual(pickLocations([loc({ isEmpty: true })], 'Z'), { picks: [], reason: 'empty' });
  assert.deepEqual(pickLocations([loc({ online: false, id: 1 }), loc({ id: 2 })], 'Z').picks.map((l) => l.id), [2]);
});

test('pickLocations takes every season of a series, one copy of each', () => {
  const r = pickLocations([loc({ id: 1, season: 1, driveSerial: 'A' }), loc({ id: 2, season: 1, driveSerial: 'B' }), loc({ id: 3, season: 2, driveSerial: 'A' })], 'A');
  assert.deepEqual(r.picks.map((l) => l.id).sort(), [2, 3]);
});

test('treeSize sums every file below a folder and a single file by itself', () => {
  const d = tmp();
  put(path.join(d, 'a', 'one.mkv'), 10);
  put(path.join(d, 'two.srt'), 5);
  assert.equal(treeSize(d), 15);
  assert.equal(treeSize(path.join(d, 'two.srt')), 5);
});

test('copyTree copies a folder tree, reports bytes and leaves the source untouched', async () => {
  const src = path.join(tmp(), 'Dune (2021)');
  put(path.join(src, 'Dune.mkv'), 3000);
  put(path.join(src, 'Subs', 'en.srt'), 20);
  const dst = path.join(tmp(), 'claude', 'Dune (2021)');
  const seen = [];
  const r = await copyTree(src, dst, { onBytes: (n) => seen.push(n) });
  assert.deepEqual({ copied: r.copied, skipped: r.skipped, bytes: r.bytes }, { copied: 2, skipped: 0, bytes: 3020 });
  assert.equal(fs.statSync(path.join(dst, 'Subs', 'en.srt')).size, 20);
  assert.equal(seen.reduce((a, b) => a + b, 0), 3020);
  assert.equal(fs.readdirSync(src).length, 2);
});

test('copyTree copies a single file into the destination folder', async () => {
  const src = path.join(tmp(), 'x.mkv');
  put(src, 10);
  const dst = path.join(tmp(), 'out');
  await copyTree(src, path.join(dst, 'x.mkv'), {});
  assert.equal(fs.statSync(path.join(dst, 'x.mkv')).size, 10);
});

test('copyTree never overwrites: a file that already exists in the destination is skipped', async () => {
  const src = path.join(tmp(), 'F');
  put(path.join(src, 'a.mkv'), 10);
  const dst = path.join(tmp(), 'F');
  put(path.join(dst, 'a.mkv'), 4);
  const r = await copyTree(src, dst, {});
  assert.equal(r.skipped, 1);
  assert.equal(fs.statSync(path.join(dst, 'a.mkv')).size, 4);
});

test('cancelling mid copy stops and removes the partial file it was writing', async () => {
  const src = path.join(tmp(), 'F');
  put(path.join(src, 'big.mkv'), 20 * 1024 * 1024);
  const dst = path.join(tmp(), 'F');
  const ac = new AbortController();
  const r = await copyTree(src, dst, { signal: ac.signal, onBytes: () => ac.abort() });
  assert.equal(r.cancelled, true);
  assert.equal(fs.existsSync(path.join(dst, 'big.mkv')), false);
});

test('copyTree lists every file it handled with size and the SHA-256 of what it read; a skipped file has no hash', async () => {
  const crypto = require('node:crypto');
  const src = path.join(tmp(), 'F');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.mkv'), 'hello world');
  fs.writeFileSync(path.join(src, 'b.srt'), 'sub');
  const dst = path.join(tmp(), 'F');
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'b.srt'), 'old'); // already there: skipped
  const r = await copyTree(src, dst, {});
  const by = Object.fromEntries(r.files.map((f) => [path.basename(f.dest), f]));
  assert.deepEqual([by['a.mkv'].size, by['a.mkv'].sha], [11, crypto.createHash('sha256').update('hello world').digest('hex')]);
  assert.equal(by['a.mkv'].src, path.join(src, 'a.mkv'));
  assert.deepEqual([by['b.srt'].size, by['b.srt'].sha], [3, null]); // size of the source, hash unknown
});
