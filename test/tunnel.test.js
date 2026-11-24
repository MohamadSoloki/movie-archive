'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTunnel } = require('../src/core/tunnel.js');

function fakeProc() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.killed = false;
  p.kill = () => { p.killed = true; p.emit('exit', null); };
  return p;
}
const make = (over = {}) => {
  const calls = { spawn: [], download: [] };
  const proc = fakeProc();
  const tunnel = createTunnel({
    dir: '/ud', platform: 'win32', timeoutMs: 50,
    exists: () => true,
    download: async (url, dest) => { calls.download.push([url, dest]); },
    spawn: (exe, args) => { calls.spawn.push([exe, args]); return proc; },
    ...over,
  });
  return { tunnel, calls, proc };
};

test('tunnel: starts cloudflared for the local port and reports the public https address it prints', async () => {
  const { tunnel, calls, proc } = make();
  const changes = [];
  tunnel.onChange((s) => changes.push(s.state));
  const started = tunnel.start(8787);
  assert.equal(tunnel.status().state, 'starting');
  proc.stderr.emit('data', Buffer.from('INF Requesting new quick Tunnel\nINF |  https://quiet-river-1234.trycloudflare.com  |\n'));
  assert.deepEqual(await started, { ok: true, url: 'https://quiet-river-1234.trycloudflare.com' });
  assert.deepEqual(calls.spawn[0][1], ['tunnel', '--url', 'http://127.0.0.1:8787', '--no-autoupdate']);
  assert.match(calls.spawn[0][0], /cloudflared\.exe$/);
  assert.deepEqual(tunnel.status(), { state: 'on', url: 'https://quiet-river-1234.trycloudflare.com', error: null });
  assert.deepEqual(changes, ['starting', 'on']);
  assert.deepEqual(await tunnel.start(8787), { ok: true, url: 'https://quiet-river-1234.trycloudflare.com' }); // already on: no second process
  assert.equal(calls.spawn.length, 1);
  await tunnel.stop();
  assert.equal(proc.killed, true);
  assert.deepEqual(tunnel.status(), { state: 'off', url: null, error: null });
});

test('tunnel: downloads cloudflared once when it is not there, and says so when the download fails', async () => {
  const { tunnel, calls, proc } = make({ exists: () => false });
  const started = tunnel.start(1);
  await new Promise((r) => setImmediate(r));
  proc.stdout.emit('data', 'https://a-b.trycloudflare.com');
  await started;
  assert.equal(calls.download.length, 1);
  assert.match(calls.download[0][0], /^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/latest\/download\/cloudflared-windows-amd64\.exe$/);
  assert.match(calls.download[0][1], /cloudflared\.exe$/);
  const bad = make({ exists: () => false, download: async () => { throw new Error('offline'); } });
  assert.deepEqual(await bad.tunnel.start(1), { ok: false, error: 'download' });
  assert.deepEqual(bad.tunnel.status(), { state: 'error', url: null, error: 'download' });
});

test('tunnel: a missing program, a silent one and one that quits are errors, and the tunnel can be started again after them', async () => {
  const noBin = make({ spawn: () => { const p = fakeProc(); setImmediate(() => p.emit('error', new Error('ENOENT'))); return p; } });
  assert.deepEqual(await noBin.tunnel.start(1), { ok: false, error: 'no_binary' });
  const silent = make();
  assert.deepEqual(await silent.tunnel.start(1), { ok: false, error: 'timeout' });
  assert.equal(silent.proc.killed, true);
  const quits = make();
  const p = quits.tunnel.start(1);
  quits.proc.emit('exit', 1);
  assert.deepEqual(await p, { ok: false, error: 'exited' });
  const again = make();
  const q = again.tunnel.start(1);
  again.proc.stdout.emit('data', 'https://x.trycloudflare.com');
  assert.equal((await q).ok, true);
  again.proc.emit('exit', 1); // dies later: back to off, the address is gone
  assert.deepEqual(again.tunnel.status(), { state: 'off', url: null, error: null });
});

test('tunnel: only the Windows program is downloaded; elsewhere the owner must install cloudflared', async () => {
  const { tunnel } = make({ platform: 'linux', exists: () => false });
  assert.deepEqual(await tunnel.start(1), { ok: false, error: 'download' });
});
