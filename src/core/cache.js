'use strict';

function getCache(db, key) {
  const row = db.prepare('SELECT value FROM cache WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : undefined;
}

function putCache(db, key, value) {
  db.prepare('INSERT INTO cache(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

// The loader runs only when the key is missing. A loader that throws stores nothing, so errors are retried.
async function cached(db, key, loader) {
  const hit = getCache(db, key);
  if (hit !== undefined) return hit;
  const value = await loader();
  putCache(db, key, value);
  return value;
}

// OMDb title search, stored per (title, year): opening the same folder twice costs one request.
function searchCached(db, omdb, title, year = null) {
  return cached(db, `s|${title.toLowerCase()}|${year ?? ''}`, () => omdb.search(title, year));
}

module.exports = { getCache, putCache, cached, searchCached };
