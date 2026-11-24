'use strict';
const { normalizeFa } = require('./persian.js');

const keyOf = (text) => normalizeFa(text).replace(/[^\p{L}\p{N}]+/gu, '');
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// "Ali R." and "ali  r" are the same customer; so are Arabic and Persian spellings of a name
const customerKey = keyOf;

// What counts cost: a price per movie, per season and per single episode (a season copied only in part).
// Size never counts. Without an episode price a partial season costs a whole season. null when no price is set.
function priceCount({ movies = 0, seasons = 0, episodes = 0 }, { priceMovie = 0, priceSeason = 0, priceEpisode = 0 } = {}) {
  if (!(priceMovie > 0 || priceSeason > 0 || priceEpisode > 0)) return null;
  const byMovies = movies * priceMovie;
  const bySeasons = seasons * priceSeason;
  const byEpisodes = episodes * priceEpisode;
  return { movies, seasons, episodes, byMovies, bySeasons, byEpisodes, total: byMovies + bySeasons + byEpisodes };
}

// The same for the jobs of a copy: a job with a season is a season; one that also lists `episodes` (a count) is a partial season.
// A collection folder counts as one movie.
function priceOf(jobs, prices = {}) {
  const partial = jobs.filter((j) => j.season != null && j.episodes != null);
  const wholeSeasons = jobs.filter((j) => j.season != null).length - partial.length;
  const movies = jobs.length - wholeSeasons - partial.length;
  const perEpisode = prices.priceEpisode > 0;
  return priceCount({
    movies,
    seasons: wholeSeasons + (perEpisode ? 0 : partial.length),
    episodes: perEpisode ? partial.reduce((n, j) => n + j.episodes, 0) : 0,
  }, prices);
}

// `paid` = what the customer handed over now; left out it means the whole price. Without a price nothing is owed.
function recordOrder(db, { customer = '', phone = '', note = '', items, bytes = 0, price = null, paid = null }, now) {
  const name = clean(customer, 80);
  const paidNow = price == null ? 0 : Math.min(price, Math.max(0, Math.round(Number(paid ?? price)) || 0));
  const id = Number(db.prepare('INSERT INTO orders(customer, customer_key, phone, note, created, bytes, price, paid) VALUES(?,?,?,?,?,?,?,?)')
    .run(name, customerKey(name), clean(phone, 30) || null, clean(note, 200) || null, now, bytes, price, paidNow).lastInsertRowid);
  const ins = db.prepare('INSERT INTO order_items(order_id, ref, title, year, kind, detail) VALUES(?,?,?,?,?,?)');
  for (const i of items) ins.run(id, i.ref, i.title, i.year ?? null, i.kind ?? null, i.detail ?? '');
  return id;
}

function listOrders(db, { customer } = {}) {
  const key = customer == null ? null : customerKey(customer);
  const rows = key === null ? db.prepare('SELECT * FROM orders ORDER BY created DESC, id DESC').all()
    : db.prepare('SELECT * FROM orders WHERE customer_key = ? ORDER BY created DESC, id DESC').all(key);
  const items = db.prepare('SELECT ref, title, year, kind, detail FROM order_items WHERE order_id = ? ORDER BY rowid');
  return rows.map((r) => ({ id: r.id, customer: r.customer, phone: r.phone, note: r.note, created: r.created, bytes: r.bytes, price: r.price,
    paid: r.paid, due: dueOf(r),
    items: items.all(r.id).map((i) => ({ ...i })) }));
}

const dueOf = (r) => (r.price == null ? 0 : Math.max(0, r.price - r.paid));

// a payment adds to what was paid, never past the price; setPaid replaces it (a correction)
function payOrder(db, id, amount) {
  const n = Math.round(Number(amount));
  if (!(n > 0)) return { ok: false, error: 'bad_amount' };
  const r = db.prepare('SELECT price, paid FROM orders WHERE id = ?').get(id);
  if (!r) return { ok: false, error: 'unknown' };
  if (r.price == null) return { ok: false, error: 'no_price' };
  return setPaid(db, id, r.paid + n);
}
function setPaid(db, id, amount) {
  const n = Math.round(Number(amount));
  if (!(n >= 0)) return { ok: false, error: 'bad_amount' };
  const r = db.prepare('SELECT price FROM orders WHERE id = ?').get(id);
  if (!r) return { ok: false, error: 'unknown' };
  if (r.price == null) return { ok: false, error: 'no_price' };
  const paid = Math.min(r.price, n);
  db.prepare('UPDATE orders SET paid = ? WHERE id = ?').run(paid, id);
  return { ok: true, paid, due: r.price - paid };
}

// named customers who still owe, biggest debt first; a nameless order has nobody to ask
function debtors(db) {
  const by = new Map();
  for (const r of db.prepare("SELECT customer, customer_key, phone, created, price, paid FROM orders WHERE customer_key != '' AND price IS NOT NULL AND price > paid ORDER BY created DESC, id DESC").all()) {
    const d = by.get(r.customer_key) ?? { name: r.customer, phone: null, due: 0, orders: 0, last: r.created };
    if (r.customer < d.name) d.name = r.customer;
    d.phone ??= r.phone;
    d.due += r.price - r.paid;
    d.orders += 1;
    by.set(r.customer_key, d);
  }
  return [...by.values()].sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
}

const pad = (n) => String(n).padStart(2, '0');

// income and demand: totals, per day and per month (the computer's local calendar, newest first) and the titles copied most often.
// `since` (epoch ms) keeps only newer orders. An order without a price adds to the counts but not to the money.
function salesReport(db, { since = 0 } = {}) {
  const rows = db.prepare('SELECT id, created, price, paid FROM orders WHERE created >= ? ORDER BY created DESC, id DESC').all(since);
  const totals = { orders: 0, price: 0, paid: 0, due: 0 };
  const days = new Map();
  const months = new Map();
  const bump = (map, key, label, r) => {
    const g = map.get(key) ?? { [label]: key, orders: 0, price: 0, paid: 0 };
    g.orders += 1; g.price += r.price ?? 0; g.paid += r.paid;
    map.set(key, g);
  };
  for (const r of rows) {
    const d = new Date(r.created);
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    bump(days, `${month}-${pad(d.getDate())}`, 'day', r);
    bump(months, month, 'month', r);
    totals.orders += 1; totals.price += r.price ?? 0; totals.paid += r.paid; totals.due += dueOf(r);
  }
  const top = new Map();
  // how many orders held the title (three seasons of one show in one order count once)
  for (const i of db.prepare('SELECT i.ref, i.title, o.id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.created >= ? ORDER BY o.created, o.id').all(since)) {
    const t = top.get(i.ref) ?? { ref: i.ref, title: i.title, orderIds: new Set() };
    t.orderIds.add(i.id); t.title = i.title;
    top.set(i.ref, t);
  }
  return { totals, days: [...days.values()], months: [...months.values()],
    top: [...top.values()].map((t) => ({ ref: t.ref, title: t.title, count: t.orderIds.size }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)).slice(0, 20) };
}

// refs this customer already received, each with the order that delivered it last; an unnamed order is no history
function deliveredTo(db, customer, refs) {
  const out = new Map();
  const key = customerKey(customer);
  if (!key || !refs.length) return out;
  const q = db.prepare(`SELECT o.id, o.created FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.customer_key = ? AND i.ref = ? ORDER BY o.created DESC, o.id DESC LIMIT 1`);
  for (const ref of refs) {
    const r = q.get(key, ref);
    if (r) out.set(ref, { orderId: r.id, created: r.created });
  }
  return out;
}

function customers(db) {
  return db.prepare(`SELECT MIN(customer) AS name, customer_key AS key, COUNT(*) AS orders, MAX(created) AS last,
    SUM(CASE WHEN price IS NOT NULL AND price > paid THEN price - paid ELSE 0 END) AS due FROM orders
    WHERE customer_key != '' GROUP BY customer_key ORDER BY name COLLATE NOCASE`).all().map((c) => ({ ...c }));
}

function removeOrder(db, id) {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
}

// A film a customer asked for that the archive lacks. Asking again counts up; null for an empty or too long name.
// `who` ({ customer, phone }, optional) is remembered once per person, so the shop can tell them when the film arrives.
function addRequest(db, name, now, who = {}) {
  const text = clean(name, 101);
  const key = keyOf(text);
  if (!key || text.length > 100) return null;
  db.prepare('INSERT INTO requests(name, key, count, last) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1, last = excluded.last')
    .run(text, key, now);
  const r = db.prepare('SELECT id, name, count FROM requests WHERE key = ?').get(key);
  addAsker(db, r.id, who, now);
  return { id: r.id, name: r.name, count: r.count };
}

function addAsker(db, requestId, { customer = '', phone = '' } = {}, created) {
  const name = clean(customer, 80);
  const tel = clean(phone, 30);
  const whoKey = `${customerKey(name)}|${normalizeFa(tel).replace(/\D/g, '')}`;
  if (whoKey === '|') return;
  db.prepare('INSERT OR IGNORE INTO request_askers(request_id, name, phone, who_key, created) VALUES(?,?,?,?,?)').run(requestId, name, tel || null, whoKey, created);
}

function listRequests(db) {
  const askers = db.prepare('SELECT id, name, phone, created FROM request_askers WHERE request_id = ? ORDER BY created, id');
  return db.prepare('SELECT id, name, count, last FROM requests ORDER BY count DESC, last DESC, id').all()
    .map((r) => ({ ...r, askers: askers.all(r.id).map((a) => ({ ...a })) }));
}

const removeAsker = (db, id) => { db.prepare('DELETE FROM request_askers WHERE id = ?').run(id); };

function removeRequest(db, id) {
  db.prepare('DELETE FROM request_askers WHERE request_id = ?').run(id);
  db.prepare('DELETE FROM requests WHERE id = ?').run(id);
}

module.exports = { addAsker, removeAsker, payOrder, setPaid, debtors, salesReport, customerKey, nameKey: keyOf, priceCount, priceOf, recordOrder, listOrders, deliveredTo, customers, removeOrder, addRequest, listRequests, removeRequest };
