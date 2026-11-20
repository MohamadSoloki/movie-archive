'use strict';

const STOP = Symbol('stop');

// Runs fn over items with at most `limit` in flight. fn returning STOP, or throwing, starts no new item;
// the ones already running finish first, then the first error (if any) is thrown.
async function pool(items, limit, fn) {
  let next = 0;
  let stopped = false;
  let failure = null;
  const worker = async () => {
    while (!stopped && next < items.length) {
      try {
        if (await fn(items[next++]) === STOP) stopped = true;
      } catch (e) {
        stopped = true;
        failure ??= { e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  if (failure) throw failure.e;
}

module.exports = { pool, STOP };
