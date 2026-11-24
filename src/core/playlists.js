'use strict';
const { normalizeFa } = require('./persian.js');

// "My collections": named lists the owner builds by hand (a saga, a mood, a shelf), films in the order he chose.
// A film is stored by its durable reference (imdb id, mal:<id> or name|year, see api refOfEntry), so a rescan or a fix keeps the list.
const NAME_MAX = 80;
const NOTE_MAX = 500;

const clean = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const nameKey = (name) => normalizeFa(clean(name, NAME_MAX)).replace(/\s+/g, ' ');

function create(db, { name, note }, created) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return { ok: false, error: 'empty' };
  if (n.length > NAME_MAX) return { ok: false, error: 'too_long' };
  if (nameTaken(db, n)) return { ok: false, error: 'exists' };
  const id = Number(db.prepare('INSERT INTO playlists(name, note, created) VALUES(?, ?, ?)').run(n, clean(note, NOTE_MAX), created).lastInsertRowid);
  return { ok: true, id };
}

function nameTaken(db, name, exceptId = null) {
  const k = nameKey(name);
  return db.prepare('SELECT id, name FROM playlists').all().some((p) => p.id !== exceptId && nameKey(p.name) === k);
}

function update(db, id, { name, note }) {
  const cur = db.prepare('SELECT name, note FROM playlists WHERE id = ?').get(id);
  if (!cur) return { ok: false, error: 'unknown' };
  const n = name === undefined ? cur.name : String(name).replace(/\s+/g, ' ').trim();
  if (!n) return { ok: false, error: 'empty' };
  if (n.length > NAME_MAX) return { ok: false, error: 'too_long' };
  if (nameTaken(db, n, id)) return { ok: false, error: 'exists' };
  db.prepare('UPDATE playlists SET name = ?, note = ? WHERE id = ?').run(n, note === undefined ? cur.note : clean(note, NOTE_MAX), id);
  return { ok: true };
}

const exists = (db, id) => !!db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id);
const list = (db) => db.prepare(`SELECT p.id, p.name, p.note, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS count
  FROM playlists p ORDER BY p.created, p.id`).all().map((r) => ({ ...r }));
const refsOf = (db, id) => db.prepare('SELECT ref FROM playlist_items WHERE playlist_id = ? ORDER BY pos').all(id).map((r) => r.ref);

// the whole order is replaced; a repeated reference keeps its first place. `tx: false` when the caller already holds a transaction (backup import)
function setRefs(db, id, refs, { tx = true } = {}) {
  if (tx) db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO playlist_items(playlist_id, ref, pos) VALUES(?, ?, ?)');
    [...new Set(refs)].forEach((r, i) => ins.run(id, r, i));
    if (tx) db.exec('COMMIT');
  } catch (e) { if (tx) db.exec('ROLLBACK'); throw e; }
}

// new films go to the end, those already there keep their place; returns how many were new
function addRefs(db, id, refs) {
  const have = new Set(refsOf(db, id));
  const fresh = [...new Set(refs)].filter((r) => !have.has(r));
  setRefs(db, id, [...refsOf(db, id), ...fresh]);
  return fresh.length;
}

function removeRef(db, id, ref) {
  db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND ref = ?').run(id, ref);
  setRefs(db, id, refsOf(db, id)); // close the gap
}

function remove(db, id) {
  db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id);
  return Number(db.prepare('DELETE FROM playlists WHERE id = ?').run(id).changes) > 0;
}

module.exports = { create, update, exists, list, refsOf, setRefs, addRefs, removeRef, remove, nameTaken, NAME_MAX };
