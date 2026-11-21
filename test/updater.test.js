'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../src/updater.js');

// a stand-in for electron-updater's autoUpdater
function fake({ available = null, checkError = null, downloadError = null, percents = [] } = {}) {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = async () => {
    u.calls.push('check');
    if (checkError) throw checkError;
    return available ? { isUpdateAvailable: true, updateInfo: { version: available } } : { isUpdateAvailable: false };
  };
  u.downloadUpdate = async () => {
    u.calls.push('download');
    for (const p of percents) u.emit('download-progress', { percent: p });
    if (downloadError) throw downloadError;
  };
  u.quitAndInstall = (...args) => u.calls.push(['install', ...args]);
  return u;
}
const packaged = (u) => createUpdater({ isPackaged: true, getUpdater: () => u });

test('from source the updater is never loaded', async () => {
  let loaded = false;
  const u = createUpdater({ isPackaged: false, getUpdater: () => { loaded = true; } });
  assert.deepEqual(await u.check(), { state: 'dev' });
  assert.deepEqual(await u.download(() => {}), { state: 'dev' });
  u.install();
  assert.equal(loaded, false);
});

test('check: no newer release answers latest, and never downloads by itself', async () => {
  const f = fake();
  assert.deepEqual(await packaged(f).check(), { state: 'latest' });
  assert.equal(f.autoDownload, false);
  assert.deepEqual(f.calls, ['check']);
});

test('check: a newer release answers available with its version, nothing is downloaded yet', async () => {
  const f = fake({ available: '0.5.0' });
  assert.deepEqual(await packaged(f).check(), { state: 'available', version: '0.5.0' });
  assert.deepEqual(f.calls, ['check']);
});

test('check: offline answers error, never throws', async () => {
  assert.deepEqual(await packaged(fake({ checkError: new Error('offline') })).check(), { state: 'error' });
});

test('download: reports the percent while it runs, then answers ready', async () => {
  const f = fake({ available: '0.5.0', percents: [10.4, 55.5, 100] });
  const u = packaged(f);
  await u.check();
  const seen = [];
  assert.deepEqual(await u.download((p) => seen.push(p)), { state: 'ready' });
  assert.deepEqual(seen, [{ type: 'update', percent: 10 }, { type: 'update', percent: 56 }, { type: 'update', percent: 100 }]);
  assert.equal(f.listenerCount('download-progress'), 0);
});

test('download: a failure answers error with its message and stops listening', async () => {
  const f = fake({ downloadError: new Error('disk full') });
  const r = await packaged(f).download(() => {});
  assert.deepEqual(r, { state: 'error', message: 'disk full' });
  assert.equal(f.listenerCount('download-progress'), 0);
});

test('a second download while one runs answers busy', async () => {
  const f = fake({ percents: [1] });
  const u = packaged(f);
  const first = u.download(() => {});
  assert.deepEqual(await u.download(() => {}), { state: 'busy' });
  assert.equal((await first).state, 'ready');
});

test('install quits, installs silently and starts the app again, only from the packaged app', () => {
  const f = fake();
  createUpdater({ isPackaged: false, getUpdater: () => f }).install();
  assert.deepEqual(f.calls, []);
  packaged(f).install();
  assert.deepEqual(f.calls, [['install', true, true]]);
});
