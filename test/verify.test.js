'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashFile, verifyFiles } = require('../src/core/verify.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vf-'));
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
function made(dir, name, text, withSha = true) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return { dest: p, size: Buffer.byteLength(text), sha: withSha ? sha(text) : null };
}

test('hashFile gives the SHA-256 of the file and reports the bytes it read', async () => {
  const dir = tmp();
  const f = made(dir, 'a.bin', 'abc');
  let bytes = 0;
  assert.equal(await hashFile(f.dest, { onBytes: (n) => { bytes += n; } }), sha('abc'));
  assert.equal(bytes, 3);
});

test('a complete copy has no problems, quick or deep', async () => {
  const dir = tmp();
  const files = [made(dir, 'a.mkv', 'aaaa'), made(dir, 'S/b.srt', 'bb')];
  assert.deepEqual((await verifyFiles(files, { deep: false })).problems, []);
  assert.deepEqual((await verifyFiles(files, { deep: true })).problems, []);
});

test('a missing file is a problem in both modes', async () => {
  const dir = tmp();
  const f = made(dir, 'a.mkv', 'aaaa');
  fs.rmSync(f.dest);
  for (const deep of [false, true]) assert.deepEqual((await verifyFiles([f], { deep })).problems, [{ dest: f.dest, reason: 'missing' }]);
});

test('a file of the wrong size is a problem in both modes (a cut-off copy)', async () => {
  const dir = tmp();
  const f = made(dir, 'a.mkv', 'aaaa');
  fs.writeFileSync(f.dest, 'aa');
  for (const deep of [false, true]) assert.deepEqual((await verifyFiles([f], { deep })).problems, [{ dest: f.dest, reason: 'size' }]);
});

test('same size but changed content passes the quick check and fails the deep one', async () => {
  const dir = tmp();
  const f = made(dir, 'a.mkv', 'aaaa');
  fs.writeFileSync(f.dest, 'aaab');
  assert.deepEqual((await verifyFiles([f], { deep: false })).problems, []);
  assert.deepEqual((await verifyFiles([f], { deep: true })).problems, [{ dest: f.dest, reason: 'hash' }]);
});

test('a file with no stored hash is checked by size only, even in deep mode', async () => {
  const dir = tmp();
  const f = made(dir, 'a.mkv', 'aaaa', false);
  fs.writeFileSync(f.dest, 'aaab');
  assert.deepEqual((await verifyFiles([f], { deep: true })).problems, []);
});

test('verification reports progress and stops when cancelled', async () => {
  const dir = tmp();
  const files = [made(dir, 'a', 'aaaa'), made(dir, 'b', 'bbbb'), made(dir, 'c', 'cccc')];
  const seen = [];
  await verifyFiles(files, { deep: true, onFile: (i, n) => seen.push([i, n]) });
  assert.deepEqual(seen, [[0, 3], [1, 3], [2, 3]]);
  const ac = new AbortController();
  const r = await verifyFiles(files, { deep: true, signal: ac.signal, onFile: (i) => { if (i === 1) ac.abort(); } });
  assert.equal(r.cancelled, true);
});
