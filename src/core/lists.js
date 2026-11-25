'use strict';
const { createHash } = require('node:crypto');

// The browser owns one editable row. The public reference cannot be used as its private edit key.
function saveWish(db, { name, phone, note, editKey, items }, now, limit) {
  const keyHash = editKey ? createHash('sha256').update(editKey).digest('hex') : null;
  const previous = keyHash ? db.prepare('SELECT * FROM wishes WHERE edit_key_hash = ?').get(keyHash) : null;
  const values = [name, phone || null, note || null, JSON.stringify(items)];
  if (previous) {
    const previousValues = [previous.name, previous.phone, previous.note, previous.items];
    if (values.some((value, i) => value !== previousValues[i])) {
      const updated = Math.max(now, (previous.updated ?? previous.created) + 1);
      db.prepare('UPDATE wishes SET name = ?, phone = ?, note = ?, items = ?, updated = ? WHERE id = ?')
        .run(...values, updated, previous.id);
    }
    return previous.id;
  }
  if (!items.length) return null;
  if (db.prepare('SELECT COUNT(*) c FROM wishes').get().c >= limit) return 0;
  return Number(db.prepare('INSERT INTO wishes(name, phone, note, items, created, edit_key_hash) VALUES(?,?,?,?,?,?)')
    .run(...values, now, keyHash).lastInsertRowid);
}

// A customer sends their whole selection again: what to add to and take out of the list already made for them.
// `fromPhone` = films that came from this customer's earlier lists. Only those can be taken out; a film the owner added by hand stays,
// and a film the owner removed stays removed even if the customer still has it selected (it was already offered once).
function diffWish({ have = [], fromPhone = [], wanted = [] }) {
  const inList = new Set(have);
  const offered = new Set(fromPhone);
  const want = new Set(wanted);
  const add = [...want].filter((k) => !inList.has(k) && !offered.has(k));
  const remove = [...offered].filter((k) => inList.has(k) && !want.has(k));
  return { add, remove };
}

module.exports = { diffWish, saveWish };
