'use strict';
const { normalizeFa } = require('./persian.js');

const GB = 1024 ** 3;
const keyOf = (text) => normalizeFa(text).replace(/[^\p{L}\p{N}]+/gu, '');
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// "Ali R." and "ali  r" are the same customer; so are Arabic and Persian spellings of a name
const customerKey = keyOf;

// What a copy costs: size × per-GB price, plus a price per movie and per season. null when no price is set.
// A collection folder counts as one movie.
function priceOf(jobs, { pricePerGB = 0, priceMovie = 0, priceSeason = 0 } = {}) {
  if (!(pricePerGB > 0 || priceMovie > 0 || priceSeason > 0)) return null;
  const bytes = jobs.reduce((n, j) => n + (j.bytes || 0), 0);
  const seasons = jobs.filter((j) => j.season != null).length;
  const movies = jobs.length - seasons;
  const gb = Math.round((bytes / GB) * 100) / 100;
  const bySize = Math.round(gb * (pricePerGB || 0));
  const byMovies = movies * (priceMovie || 0);
  const bySeasons = seasons * (priceSeason || 0);
  return { gb, movies, seasons, bySize, byMovies, bySeasons, total: bySize + byMovies + bySeasons };
}

function recordOrder(db, { customer = '', phone = '', note = '', items, bytes = 0, price = null }, now) {
  const name = clean(customer, 80);
  const id = Number(db.prepare('INSERT INTO orders(customer, customer_key, phone, note, created, bytes, price) VALUES(?,?,?,?,?,?,?)')
    .run(name, customerKey(name), clean(phone, 30) || null, clean(note, 200) || null, now, bytes, price).lastInsertRowid);
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
    items: items.all(r.id).map((i) => ({ ...i })) }));
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
  return db.prepare(`SELECT MIN(customer) AS name, COUNT(*) AS orders, MAX(created) AS last FROM orders
    WHERE customer_key != '' GROUP BY customer_key ORDER BY name COLLATE NOCASE`).all().map((c) => ({ ...c }));
}

function removeOrder(db, id) {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
}

// A film a customer asked for that the archive lacks. Asking again counts up; null for an empty or too long name.
function addRequest(db, name, now) {
  const text = clean(name, 101);
  const key = keyOf(text);
  if (!key || text.length > 100) return null;
  db.prepare('INSERT INTO requests(name, key, count, last) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1, last = excluded.last')
    .run(text, key, now);
  const r = db.prepare('SELECT id, name, count FROM requests WHERE key = ?').get(key);
  return { id: r.id, name: r.name, count: r.count };
}

function listRequests(db) {
  return db.prepare('SELECT id, name, count, last FROM requests ORDER BY count DESC, last DESC, id').all().map((r) => ({ ...r }));
}

function removeRequest(db, id) {
  db.prepare('DELETE FROM requests WHERE id = ?').run(id);
}

module.exports = { customerKey, nameKey: keyOf, priceOf, recordOrder, listOrders, deliveredTo, customers, removeOrder, addRequest, listRequests, removeRequest };
