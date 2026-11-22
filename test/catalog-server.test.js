'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogServer } = require('../src/core/catalog-server.js');

function make(over = {}) {
  const wishes = [];
  let t = 1000;
  const srv = createCatalogServer({
    lang: () => 'fa',
    films: (lang) => [{ k: 't:1', t: 'Alien', y: '1979', g: [lang === 'en' ? 'Horror' : 'ترسناک'], r: '8.5', b: ['1080p'], a: ['بیگانه'], p: true }],
    font: () => Buffer.from('WOFF'),
    ask: (name) => (name === 'known' ? { ok: true, inArchive: ['Alien'] } : { ok: true, inArchive: [] }),
    posterFile: (k) => (k === 't:1' ? Buffer.from('JPEG') : null),
    known: (k) => (k === 't:1' ? { key: k, title: 'Alien', year: '1979' } : null),
    submit: (w) => { wishes.push(w); return wishes.length; },
    clock: () => t,
    ...over,
  });
  return { srv, wishes, tick: (ms) => { t += ms; } };
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('serves the page, the film list and posters, read-only', async () => {
  const { srv } = make();
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/);
    assert.deepEqual((await (await fetch(`${base}/api/films?lang=en`)).json())[0].g, ['Horror']);
    assert.deepEqual((await (await fetch(`${base}/api/films`)).json())[0].g, ['ترسناک']);
    assert.match(await (await fetch(`${base}/?lang=en`)).text(), /dir="ltr"/);
    const img = await fetch(`${base}/poster/${encodeURIComponent('t:1')}`);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await img.text()), 'JPEG');
    const font = await fetch(`${base}/font.woff2`);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.equal(await font.text(), 'WOFF');
    assert.match(await (await fetch(`${base}/`)).text(), /font-family: *"?Vazirmatn"?[^}]*url\("\/font\.woff2"\)|url\("\/font\.woff2"\)/);
    assert.equal((await fetch(`${base}/poster/x`)).status, 404);
    assert.equal((await fetch(`${base}/etc/passwd`)).status, 404);
    assert.equal((await fetch(`${base}/api/films`, { method: 'DELETE' })).status, 405);
  } finally { await srv.stop(); }
});

test('a customer list is accepted once validated, and only known films are kept', async () => {
  const { srv, wishes } = make();
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const url = `http://127.0.0.1:${port}/api/wish`;
    const first = await post(url, { name: 'Ali', phone: '0912', note: 'hi', keys: ['t:1', 'bogus', 't:1'] });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, id: 1 });
    assert.equal(wishes.length, 1);
    assert.deepEqual(wishes[0].items, [{ key: 't:1', title: 'Alien', year: '1979' }]);
    assert.equal(wishes[0].name, 'Ali');
    assert.equal((await post(url, { name: '', keys: ['t:1'] })).status, 400);
    assert.equal((await post(url, { name: 'Ali', keys: ['bogus'] })).status, 400);
    assert.equal((await post(url, 'not json')).status, 400);
    assert.equal((await post(url, { name: 'x'.repeat(5), keys: Array.from({ length: 300 }, () => 't:1') })).status, 400);
    assert.equal((await post(url, JSON.stringify({ name: 'a', note: 'x'.repeat(40000), keys: ['t:1'] }))).status, 413);
  } finally { await srv.stop(); }
});

test('one address can send only a few lists in ten minutes', async () => {
  const { srv, tick } = make();
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const url = `http://127.0.0.1:${port}/api/wish`;
    const send = () => post(url, { name: 'Ali', keys: ['t:1'] });
    for (let i = 0; i < 5; i += 1) assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 429);
    tick(11 * 60 * 1000);
    assert.equal((await send()).status, 200);
  } finally { await srv.stop(); }
});

test('a customer can ask for a film the archive lacks; the answer says when it is already there', async () => {
  const { srv } = make();
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const url = `http://127.0.0.1:${port}/api/ask`;
    assert.deepEqual(await (await post(url, { name: 'known' })).json(), { ok: true, inArchive: ['Alien'] });
    assert.deepEqual(await (await post(url, { name: 'something new' })).json(), { ok: true, inArchive: [] });
    assert.equal((await post(url, { name: '  ' })).status, 400);
    assert.equal((await post(url, { name: 'x'.repeat(101) })).status, 400);
    assert.equal((await fetch(url)).status, 405);
  } finally { await srv.stop(); }
});

test('a full inbox says so instead of storing more', async () => {
  const { srv } = make({ submit: () => 0 });
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    assert.equal((await post(`http://127.0.0.1:${port}/api/wish`, { name: 'Ali', keys: ['t:1'] })).status, 503);
  } finally { await srv.stop(); }
});
