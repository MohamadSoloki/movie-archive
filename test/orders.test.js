'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const o = require('../src/core/orders.js');

const GB = 1024 ** 3;
const item = (ref, title, extra = {}) => ({ ref, title, year: '2020', kind: 'movie', detail: '', ...extra });

test('price = per movie + per season + per single episode; size never counts; nothing set means no price', () => {
  const jobs = [{ bytes: 2 * GB, season: null }, { bytes: 1 * GB, season: null }, { bytes: 4 * GB, season: '1' }, { bytes: 4 * GB, season: '2' },
    { bytes: GB, season: '3', episodes: 3 }];
  assert.equal(o.priceOf(jobs, { priceMovie: 0, priceSeason: 0, priceEpisode: 0 }), null);
  assert.deepEqual(o.priceOf(jobs, { priceMovie: 5000, priceSeason: 20000, priceEpisode: 2000 }),
    { movies: 2, seasons: 2, episodes: 3, byMovies: 10000, bySeasons: 40000, byEpisodes: 6000, total: 56000 });
  // without an episode price a partial season costs a whole season
  assert.deepEqual(o.priceOf(jobs, { priceMovie: 0, priceSeason: 20000 }),
    { movies: 2, seasons: 3, episodes: 0, byMovies: 0, bySeasons: 60000, byEpisodes: 0, total: 60000 });
  // the calculator asks the same question without any files
  assert.deepEqual(o.priceCount({ movies: 5, seasons: 3, episodes: 4 }, { priceMovie: 5000, priceSeason: 20000, priceEpisode: 2000 }),
    { movies: 5, seasons: 3, episodes: 4, byMovies: 25000, bySeasons: 60000, byEpisodes: 8000, total: 93000 });
  assert.equal(o.priceCount({ movies: 5 }, {}), null);
});

test('customer names match ignoring letter forms, spaces and case', () => {
  assert.equal(o.customerKey('  علي  رضایی '), o.customerKey('علی رضایی'));
  assert.equal(o.customerKey('Ali  R.'), 'alir');
  assert.equal(o.customerKey('  '), '');
});

test('an order keeps its films; delivery history answers per customer', () => {
  const db = openDb();
  const id = o.recordOrder(db, { customer: 'علي', phone: '0912', note: '', items: [item('tt1', 'A'), item('tt2', 'B')], bytes: 5, price: 100 }, 1000);
  o.recordOrder(db, { customer: 'Sara', items: [item('tt1', 'A')], bytes: 1, price: null }, 2000);
  o.recordOrder(db, { customer: '', items: [item('tt3', 'C')], bytes: 1, price: null }, 3000);
  const all = o.listOrders(db);
  assert.deepEqual(all.map((x) => [x.customer, x.items.length]), [['', 1], ['Sara', 1], ['علي', 2]]);
  assert.equal(all[2].phone, '0912');
  assert.deepEqual(o.listOrders(db, { customer: 'علی' }).map((x) => x.id), [id]);
  const seen = o.deliveredTo(db, 'علی', ['tt1', 'tt3', 'tt2']);
  assert.deepEqual([...seen.keys()].sort(), ['tt1', 'tt2']);
  assert.equal(seen.get('tt1').created, 1000);
  assert.equal(o.deliveredTo(db, '', ['tt3']).size, 0);
  assert.deepEqual(o.customers(db).map((c) => [c.name, c.orders]), [['Sara', 1], ['علي', 1]]);
  o.removeOrder(db, id);
  assert.equal(o.listOrders(db).length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM order_items WHERE order_id = ?').get(id).c, 0);
});

test('requests count how often a film was asked for, matching spellings', () => {
  const db = openDb();
  const a = o.addRequest(db, ' ديپارتد ', 10);
  const b = o.addRequest(db, 'دیپارتد', 20);
  o.addRequest(db, 'Dune', 30);
  assert.equal(a.id, b.id);
  assert.equal(b.count, 2);
  assert.deepEqual(o.listRequests(db).map((r) => [r.name, r.count]), [['ديپارتد', 2], ['Dune', 1]]);
  assert.equal(o.addRequest(db, '  ', 1), null);
  assert.equal(o.addRequest(db, 'x'.repeat(101), 1), null);
  o.removeRequest(db, a.id);
  assert.equal(o.listRequests(db).length, 1);
});
