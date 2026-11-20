'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, STOP } = require('../src/core/pool.js');

const tick = (ms = 5) => new Promise((r) => { setTimeout(r, ms); });

test('never runs more than the limit at once, and visits every item', async () => {
  let live = 0; let peak = 0; const seen = [];
  await pool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => { live += 1; peak = Math.max(peak, live); await tick(); live -= 1; seen.push(x); });
  assert.equal(peak, 3);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test('limit 1 keeps the order', async () => {
  const seen = [];
  await pool([1, 2, 3], 1, async (x) => { await tick(); seen.push(x); });
  assert.deepEqual(seen, [1, 2, 3]);
});

test('STOP prevents new items; those already running finish', async () => {
  const started = []; const done = [];
  await pool([1, 2, 3, 4, 5, 6], 2, async (x) => {
    started.push(x); await tick(); done.push(x);
    return x === 1 ? STOP : undefined;
  });
  assert.ok(started.length < 6);
  assert.ok(started.every((x) => done.includes(x)));
});

test('an error is thrown after the running items settle, and nothing new starts', async () => {
  const started = []; let finished = 0;
  await assert.rejects(pool([1, 2, 3, 4, 5], 2, async (x) => {
    started.push(x); await tick();
    if (x === 1) throw new TypeError('bug');
    finished += 1;
  }), TypeError);
  assert.equal(finished, started.length - 1);
  assert.ok(started.length < 5);
});

test('an empty list is fine', async () => {
  await pool([], 4, async () => { throw new Error('never'); });
});
