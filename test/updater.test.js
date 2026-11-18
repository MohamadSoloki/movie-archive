'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkForUpdates } = require('../src/updater.js');

test('running from source never loads or calls the updater', () => {
  let loaded = false;
  checkForUpdates({ isPackaged: false, getUpdater: () => { loaded = true; } });
  assert.equal(loaded, false);
});

test('a packaged app asks the updater to check and notify', () => {
  let checked = 0;
  checkForUpdates({ isPackaged: true, getUpdater: () => ({ checkForUpdatesAndNotify: async () => { checked += 1; } }) });
  assert.equal(checked, 1);
});

test('an offline or failing check is swallowed', async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  checkForUpdates({ isPackaged: true, getUpdater: () => ({ checkForUpdatesAndNotify: async () => { throw new Error('offline'); } }) });
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, []);
});
