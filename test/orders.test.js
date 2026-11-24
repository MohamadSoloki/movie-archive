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

test('a request remembers who asked, name and phone, so they can be told when the film arrives', () => {
  const db = openDb();
  const r = o.addRequest(db, 'Dune 3', 10, { customer: 'Ali', phone: '0912 111' });
  o.addRequest(db, 'dune  3', 20, { customer: ' ali ', phone: '0912111' }); // the same person again: counted in the demand, listed once
  o.addRequest(db, 'Dune 3', 30, { customer: 'Sara', phone: '' });
  o.addRequest(db, 'Dune 3', 40, { customer: '', phone: '' }); // nobody named: only the count
  const [req] = o.listRequests(db);
  assert.equal(req.count, 4);
  assert.deepEqual(req.askers.map((a) => [a.name, a.phone]), [['Ali', '0912 111'], ['Sara', null]]);
  o.removeAsker(db, req.askers[0].id);
  assert.equal(o.listRequests(db)[0].askers.length, 1);
  o.removeRequest(db, r.id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM request_askers').get().c, 0);
});

test('payment: an order is paid in full unless said otherwise, payments add up and never pass the price, no price means nothing to pay', () => {
  const db = openDb();
  const full = o.recordOrder(db, { customer: 'Ali', items: [item('tt1', 'A')], price: 50000 }, 1);
  const part = o.recordOrder(db, { customer: 'Ali', items: [item('tt2', 'B')], price: 40000, paid: 10000 }, 2);
  const free = o.recordOrder(db, { customer: 'Sara', items: [item('tt3', 'C')], price: null }, 3);
  const by = (id) => o.listOrders(db).find((x) => x.id === id);
  assert.deepEqual([by(full).paid, by(full).due], [50000, 0]);
  assert.deepEqual([by(part).paid, by(part).due], [10000, 30000]);
  assert.deepEqual([by(free).paid, by(free).due], [0, 0]);
  assert.deepEqual(o.payOrder(db, part, 5000), { ok: true, paid: 15000, due: 25000 });
  assert.deepEqual(o.payOrder(db, part, 999999), { ok: true, paid: 40000, due: 0 }); // more than owed is only what was owed
  assert.deepEqual(o.payOrder(db, part, 0), { ok: false, error: 'bad_amount' });
  assert.deepEqual(o.payOrder(db, part, -5), { ok: false, error: 'bad_amount' });
  assert.deepEqual(o.payOrder(db, free, 100), { ok: false, error: 'no_price' });
  assert.deepEqual(o.payOrder(db, 999, 100), { ok: false, error: 'unknown' });
  assert.deepEqual(o.setPaid(db, part, 0), { ok: true, paid: 0, due: 40000 }); // a correction
  assert.deepEqual(o.setPaid(db, part, 60000), { ok: true, paid: 40000, due: 0 });
});

test('who owes: named customers with what is still due, biggest first; the customer list carries the debt', () => {
  const db = openDb();
  o.recordOrder(db, { customer: 'Ali', phone: '0912', items: [item('tt1', 'A')], price: 50000, paid: 20000 }, 1);
  o.recordOrder(db, { customer: ' ali ', items: [item('tt2', 'B')], price: 10000, paid: 0 }, 2);
  o.recordOrder(db, { customer: 'Sara', items: [item('tt3', 'C')], price: 5000 }, 3);
  o.recordOrder(db, { customer: 'Reza', items: [item('tt4', 'D')], price: 90000, paid: 80000 }, 4);
  o.recordOrder(db, { customer: '', items: [item('tt5', 'E')], price: 7000, paid: 0 }, 5); // nameless: counted in totals, not a debtor
  assert.deepEqual(o.debtors(db), [{ name: 'Ali', phone: '0912', due: 40000, orders: 2, last: 2 }, { name: 'Reza', phone: null, due: 10000, orders: 1, last: 4 }]);
  assert.deepEqual(o.customers(db).map((c) => [c.name, c.due]), [['Ali', 40000], ['Reza', 10000], ['Sara', 0]]);
});

test('sales report: totals, per day and per month, and the titles copied most often', () => {
  const db = openDb();
  const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
  o.recordOrder(db, { customer: 'A', items: [item('tt1', 'Alien'), item('tt2', 'Dune')], price: 10000, paid: 10000 }, at(2026, 11, 24));
  o.recordOrder(db, { customer: 'B', items: [item('tt1', 'Alien (1979)')], price: 5000, paid: 1000 }, at(2026, 11, 24, 20));
  o.recordOrder(db, { customer: 'C', items: [item('tt1', 'Alien')], price: null }, at(2026, 11, 3));
  o.recordOrder(db, { customer: 'D', items: [item('tt9', 'Old')], price: 8000, paid: 8000 }, at(2026, 9, 30));
  const r = o.salesReport(db);
  assert.deepEqual(r.totals, { orders: 4, price: 23000, paid: 19000, due: 4000 });
  assert.deepEqual(r.days.map((d) => [d.day, d.orders, d.price, d.paid]), [['2026-11-24', 2, 15000, 11000], ['2026-11-03', 1, 0, 0], ['2026-09-30', 1, 8000, 8000]]);
  assert.deepEqual(r.months.map((m) => [m.month, m.orders, m.price, m.paid]), [['2026-11', 3, 15000, 11000], ['2026-09', 1, 8000, 8000]]);
  assert.deepEqual(r.top.slice(0, 2), [{ ref: 'tt1', title: 'Alien (1979)', count: 3 }, { ref: 'tt2', title: 'Dune', count: 1 }]); // the newest name of a title
  // only the last days
  const recent = o.salesReport(db, { since: at(2026, 11, 1) });
  assert.deepEqual([recent.totals.orders, recent.days.length, recent.months.length], [3, 2, 1]);
  assert.deepEqual(recent.top.map((x) => x.ref).sort(), ['tt1', 'tt2']);
  assert.deepEqual(o.salesReport(openDb()), { totals: { orders: 0, price: 0, paid: 0, due: 0 }, days: [], months: [], top: [] });
});
