'use strict';

const MAX = 30;

// The tag as it will be stored, null when there is nothing to store, 'too_long' when it is over the limit.
function normalizeTag(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > MAX ? 'too_long' : t;
}

function addTag(db, locationIds, tag) {
  const ins = db.prepare('INSERT OR IGNORE INTO tags(location_id, tag) VALUES(?, ?)');
  for (const id of locationIds) ins.run(id, tag);
}

function removeTag(db, locationIds, tag) {
  const del = db.prepare('DELETE FROM tags WHERE location_id = ? AND tag = ?');
  for (const id of locationIds) del.run(id, tag);
}

module.exports = { normalizeTag, addTag, removeTag };
