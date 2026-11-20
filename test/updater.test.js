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

const { createUpdater } = require('../src/updater.js');

test('manual check: from source it says dev and never loads the updater', async () => {
  let loaded = false;
  const u = createUpdater({ isPackaged: false, getUpdater: () => { loaded = true; } });
  assert.deepEqual(await u.check(), { state: 'dev' });
  assert.equal(loaded, false);
});

test('manual check: no newer release answers latest', async () => {
  const u = createUpdater({ isPackaged: true, getUpdater: () => ({ checkForUpdates: async () => ({ isUpdateAvailable: false }) }) });
  assert.deepEqual(await u.check(), { state: 'latest' });
});

test('manual check: a newer release is downloaded, then answers ready with its version', async () => {
  let downloaded = false;
  const u = createUpdater({ isPackaged: true, getUpdater: () => ({
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.3.0' }, downloadPromise: Promise.resolve().then(() => { downloaded = true; }) }),
  }) });
  assert.deepEqual(await u.check(), { state: 'ready', version: '0.3.0' });
  assert.equal(downloaded, true);
});

test('manual check: offline or a failed download answers error, never throws', async () => {
  const u = createUpdater({ isPackaged: true, getUpdater: () => ({ checkForUpdates: async () => { throw new Error('offline'); } }) });
  assert.deepEqual(await u.check(), { state: 'error' });
});

test('install quits and installs only from the packaged app', () => {
  let calls = 0;
  createUpdater({ isPackaged: false, getUpdater: () => ({ quitAndInstall: () => { calls += 1; } }) }).install();
  assert.equal(calls, 0);
  createUpdater({ isPackaged: true, getUpdater: () => ({ quitAndInstall: () => { calls += 1; } }) }).install();
  assert.equal(calls, 1);
});
