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
    known: (k) => (k === 't:1' ? { key: k, title: 'Alien', year: '1979' } : k === 't:2' ? { key: k, title: 'Show', year: '2020' } : null),
    info: () => ({ prices: { movie: 5000, season: 20000, episode: 2000 }, shop: 'Net' }),
    seasons: (k) => (k === 't:2' ? [{ season: 1, episodes: [1, 2, 3], bytes: 123 }, { season: 2, episodes: null, bytes: 5 }] : null),
    submit: (w) => { wishes.push(w); return wishes.length; },
    clock: () => t,
    ...over,
  });
  return { srv, wishes, tick: (ms) => { t += ms; } };
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('serves the page, the film list and posters, read-only', async () => {
  const { srv } = make();
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/);
    // the customer's page is Persian whatever the shop's language or the query says
    assert.deepEqual((await (await fetch(`${base}/api/films?lang=en`)).json())[0].g, ['ترسناک']);
    assert.deepEqual((await (await fetch(`${base}/api/films`)).json())[0].g, ['ترسناک']);
    assert.match(await (await fetch(`${base}/?lang=en`)).text(), /<html lang="fa" dir="rtl"/);
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

test('behind the internet tunnel each customer address gets its own allowance; without the tunnel the header is ignored', async () => {
  const send = (url, ip) => post(url, { name: 'Ali', keys: ['t:1'] }, ip ? { 'cf-connecting-ip': ip } : {});
  const { srv } = make({ viaTunnel: () => true });
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const url = `http://127.0.0.1:${port}/api/wish`;
    for (let i = 0; i < 5; i += 1) assert.equal((await send(url, '5.6.7.8')).status, 200);
    assert.equal((await send(url, '5.6.7.8')).status, 429);
    assert.equal((await send(url, '9.9.9.9')).status, 200); // another customer on the same tunnel
    assert.equal((await send(url, `${'x'.repeat(200)}`)).status, 200); // a junk header is not a way around the limit: it is capped and counted
  } finally { await srv.stop(); }
  const off = make(); // no tunnel running: whoever sets the header is still one address
  const { port: p2 } = await off.srv.start(0, '127.0.0.1');
  try {
    const url = `http://127.0.0.1:${p2}/api/wish`;
    for (let i = 0; i < 5; i += 1) assert.equal((await send(url, `1.1.1.${i}`)).status, 200);
    assert.equal((await send(url, '2.2.2.2')).status, 429);
  } finally { await off.srv.stop(); }
});

test('asking can carry the customer name and phone, cleaned and capped, so the shop can tell them', async () => {
  const seen = [];
  const { srv } = make({ ask: (name, who) => { seen.push([name, who]); return { ok: true, inArchive: [] }; } });
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const url = `http://127.0.0.1:${port}/api/ask`;
    await post(url, { name: 'Dune 3', customer: '  Ali   R ', phone: `09${'1'.repeat(50)}` });
    await post(url, { name: 'Dune 4' });
    assert.deepEqual(seen, [['Dune 3', { customer: 'Ali R', phone: `09${'1'.repeat(28)}` }], ['Dune 4', { customer: '', phone: '' }]]);
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

test('the page can read the prices and the seasons of a series (no sizes), and nothing else', async () => {
  const { srv } = make();
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${base}/api/info`)).json(), { prices: { movie: 5000, season: 20000, episode: 2000 }, shop: 'Net' });
    assert.deepEqual(await (await fetch(`${base}/api/seasons?k=${encodeURIComponent('t:2')}`)).json(),
      { ok: true, seasons: [{ season: 1, episodes: [1, 2, 3] }, { season: 2, episodes: null }] });
    assert.equal((await fetch(`${base}/api/seasons?k=nope`)).status, 404);
  } finally { await srv.stop(); }
});

test('a list can name seasons and episodes of a series; the choice is cleaned and only kept for films in the list', async () => {
  const { srv, wishes } = make();
  const { port } = await srv.start(0, '127.0.0.1');
  try {
    const r = await post(`http://127.0.0.1:${port}/api/wish`, { name: 'Ali', keys: ['t:1', 't:2'],
      picks: { 't:2': { seasons: [1, 'x', -3, 1], episodes: { 2: [1, 2, 'y', 2], abc: [1] } }, 't:1': { seasons: [1] }, 't:9': { seasons: [1] } } });
    assert.equal(r.status, 200);
    assert.deepEqual(wishes[0].items.map((i) => [i.key, i.sel]), [['t:1', undefined], ['t:2', { seasons: [1], episodes: { 2: [1, 2] } }]]);
  } finally { await srv.stop(); }
});

test('phone page: its script parses, and it offers the related films of a series (rl) with a way back', () => {
  const { pageHtml } = require('../src/core/catalog-page.js');
  const html = pageHtml('fa');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /id="relbar"/);
  assert.match(html, /فیلم‌های مرتبط/);
  assert.match(html, /f\.rl/);
});
