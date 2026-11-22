'use strict';

const MAX = 30;
const ALIAS_MAX = 80;

// The tag as it will be stored, null when there is nothing to store, 'too_long' when it is over the limit.
function normalizeTag(text, max = MAX) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? 'too_long' : t;
}

function addTag(db, locationIds, tag) {
  const ins = db.prepare('INSERT OR IGNORE INTO tags(location_id, tag) VALUES(?, ?)');
  for (const id of locationIds) ins.run(id, tag);
}

function removeTag(db, locationIds, tag) {
  const del = db.prepare('DELETE FROM tags WHERE location_id = ? AND tag = ?');
  for (const id of locationIds) del.run(id, tag);
}

// other names of a film: same shape as tags, stored in their own table
function addAlias(db, locationIds, alias) {
  const ins = db.prepare('INSERT OR IGNORE INTO aliases(location_id, alias) VALUES(?, ?)');
  for (const id of locationIds) ins.run(id, alias);
}

function removeAlias(db, locationIds, alias) {
  const del = db.prepare('DELETE FROM aliases WHERE location_id = ? AND alias = ?');
  for (const id of locationIds) del.run(id, alias);
}

module.exports = { normalizeTag, addTag, removeTag, addAlias, removeAlias, ALIAS_MAX };
