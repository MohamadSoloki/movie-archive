'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRate } = require('../src/core/rate.js');

test('no speed until there are two samples', () => {
  const r = createRate();
  assert.deepEqual(r.sample(0, 0, 1000), { bytesPerSec: null, etaSec: null });
});

test('speed and time left from a steady copy', () => {
  const r = createRate();
  r.sample(0, 0, 1000);
  const s = r.sample(2000, 20_000_000, 100_000_000); // 10 MB/s, 80 MB left
  assert.equal(s.bytesPerSec, 10_000_000);
  assert.equal(s.etaSec, 8);
});

test('only the last window counts, so a speed change shows up', () => {
  const r = createRate({ windowMs: 5000 });
  r.sample(0, 0, 1e9);
  r.sample(10_000, 100_000_000, 1e9); // fast start: 10 MB/s
  const s = r.sample(20_000, 110_000_000, 1e9); // then 1 MB/s
  assert.equal(s.bytesPerSec, 1_000_000);
});

test('a stalled copy has no time left estimate', () => {
  const r = createRate();
  r.sample(0, 5, 100);
  const s = r.sample(3000, 5, 100);
  assert.equal(s.bytesPerSec, 0);
  assert.equal(s.etaSec, null);
});
