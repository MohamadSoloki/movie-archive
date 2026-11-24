'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setSetting } = require('./db.js');
const orders = require('./orders.js');
const playlists = require('./playlists.js');

const FORMAT = 'movie-archive-backup';
// what the owner made by hand, so a new computer or a wiped database can get it back; the archive itself is rescanned.
// The OMDb key stays out: a backup file gets copied around.
const SECRET = new Set(['omdbKey']);

// node:sqlite rows have no prototype; plain objects compare and serialise the same everywhere
const plain = (rows) => rows.map((r) => ({ ...r }));

// the typed films carry their facts, their files' places and the picture (small, as base64), because a rescan cannot find them again
function manualFilmsOf(db, postersDir) {
  const where = db.prepare('SELECT drive_serial AS driveSerial, rel_path AS relPath FROM locations WHERE title_id = ? ORDER BY id');
  return db.prepare("SELECT id, title, year, type, plot, genres, director, actors, runtime, country, poster_file FROM titles WHERE source = 'manual' ORDER BY id").all().map((t) => {
    let poster = null;
    if (t.poster_file && postersDir) {
      try { poster = { ext: path.extname(t.poster_file).slice(1).toLowerCase(), data: fs.readFileSync(path.join(postersDir, path.basename(t.poster_file))).toString('base64') }; } catch { /* the picture is gone: the film still comes back */ }
    }
    const { id, poster_file: _p, ...facts } = t;
    return { ...facts, locations: plain(where.all(id)), poster };
  });
}

function exportData(db, { now = Date.now(), postersDir = null } = {}) {
  const settings = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (!SECRET.has(r.key)) settings[r.key] = JSON.parse(r.value);
  const byPlace = (table, col) => db.prepare(`SELECT l.drive_serial AS driveSerial, l.rel_path AS relPath, x.${col} AS ${col}
    FROM ${table} x JOIN locations l ON l.id = x.location_id ORDER BY l.drive_serial, l.rel_path, x.${col}`).all().map((r) => ({ ...r }));
  const copies = plain(db.prepare('SELECT id, name, target, created, checked, state FROM copies ORDER BY id').all()).map(({ id, ...c }) => ({
    ...c, files: plain(db.prepare('SELECT rel, size, sha, title, drive_serial AS driveSerial, src_rel AS srcRel FROM copy_files WHERE copy_id = ? ORDER BY rowid').all(id)),
  }));
  return {
    format: FORMAT, version: 1, exportedAt: now, settings,
    tags: byPlace('tags', 'tag'), aliases: byPlace('aliases', 'alias'),
    qualityMarks: db.prepare(`SELECT l.drive_serial AS driveSerial, l.rel_path AS relPath, x.flag AS flag, x.value AS value
      FROM quality_marks x JOIN locations l ON l.id = x.location_id ORDER BY l.drive_serial, l.rel_path, x.flag`).all().map((r) => ({ ...r })),
    manualFilms: manualFilmsOf(db, postersDir),
    playlists: plain(db.prepare('SELECT id, name, note, created FROM playlists ORDER BY created, id').all()).map(({ id, ...p }) => ({ ...p, items: playlists.refsOf(db, id) })),
    reminders: plain(db.prepare('SELECT title, key, weekday, time, episode, due, enabled FROM reminders ORDER BY id').all()),
    copies,
    orders: orders.listOrders(db).map(({ id, ...o }) => o),
    requests: plain(db.prepare('SELECT name, count, last FROM requests ORDER BY id').all()),
  };
}

// Merges a backup into the database: settings are overwritten, everything else is added when missing, so importing twice
// changes nothing. Tags and aliases go to the folder with the same drive and path; those this machine does not have are counted.
function importData(db, data, { postersDir = null } = {}) {
  if (!data || typeof data !== 'object' || data.format !== FORMAT) throw new Error('not_a_backup');
  const out = { tags: 0, aliases: 0, qualityMarks: 0, manualFilms: 0, playlists: 0, reminders: 0, copies: 0, orders: 0, requests: 0, skipped: 0 };
  const arr = (v) => (Array.isArray(v) ? v : []);
  db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(data.settings && typeof data.settings === 'object' ? data.settings : {})) if (!SECRET.has(k)) setSetting(db, k, v);
    const find = db.prepare('SELECT id FROM locations WHERE drive_serial = ? AND rel_path = ?');
    for (const [list, table, col, counter] of [[data.tags, 'tags', 'tag', 'tags'], [data.aliases, 'aliases', 'alias', 'aliases']]) {
      const ins = db.prepare(`INSERT OR IGNORE INTO ${table}(location_id, ${col}) VALUES(?, ?)`);
      for (const r of arr(list)) {
        const loc = typeof r?.[col] === 'string' ? find.get(String(r.driveSerial), String(r.relPath)) : null;
        if (!loc) { out.skipped += 1; continue; }
        out[counter] += Number(ins.run(loc.id, r[col]).changes);
      }
    }
    // a mark already set on this machine is kept: the backup only fills in what is missing
    const mark = db.prepare('INSERT OR IGNORE INTO quality_marks(location_id, flag, value) VALUES(?, ?, ?)');
    for (const r of arr(data.qualityMarks)) {
      const loc = ['dub', 'sub'].includes(r?.flag) ? find.get(String(r.driveSerial), String(r.relPath)) : null;
      if (!loc) { out.skipped += 1; continue; }
      out.qualityMarks += Number(mark.run(loc.id, r.flag, r.value ? 1 : 0).changes);
    }
    // a typed film is added only when none of its files is already stored here (importing twice changes nothing)
    const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp']);
    const addTitle = db.prepare(`INSERT INTO titles(source, title, year, type, plot, genres, director, actors, runtime, country) VALUES('manual',?,?,?,?,?,?,?,?,?)`);
    const addLoc = db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, parsed_year, title_id, status, pinned) VALUES(?,?,?,?,?,?, 'matched', 1)`);
    for (const f of arr(data.manualFilms)) {
      const places = arr(f?.locations).filter((l) => typeof l?.driveSerial === 'string' && typeof l.relPath === 'string');
      if (typeof f?.title !== 'string' || !f.title.trim() || !places.length || places.some((l) => find.get(l.driveSerial, l.relPath))) continue;
      const s = (v) => (typeof v === 'string' ? v : null);
      const id = Number(addTitle.run(f.title.slice(0, 200), s(f.year), f.type === 'series' ? 'series' : 'movie', s(f.plot), s(f.genres), s(f.director), s(f.actors), s(f.runtime), s(f.country)).lastInsertRowid);
      for (const l of places) addLoc.run(l.driveSerial, l.relPath, path.basename(l.relPath), f.title, s(f.year), id);
      if (f.poster && postersDir && IMAGE.has(f.poster.ext) && typeof f.poster.data === 'string') {
        try {
          fs.mkdirSync(postersDir, { recursive: true });
          const file = `manual-${id}-${Date.now()}.${f.poster.ext}`;
          fs.writeFileSync(path.join(postersDir, file), Buffer.from(f.poster.data, 'base64'));
          db.prepare('UPDATE titles SET poster_file = ? WHERE id = ?').run(file, id);
        } catch { /* no picture: the film still comes back */ }
      }
      out.manualFilms += 1;
    }
    // a collection is added when no collection of this name is here yet
    for (const p of arr(data.playlists)) {
      if (typeof p?.name !== 'string') continue;
      const made = playlists.create(db, { name: p.name, note: p.note }, Number(p.created) || 0);
      if (!made.ok) continue;
      playlists.setRefs(db, made.id, arr(p.items).filter((r) => typeof r === 'string' && r.length <= 200), { tx: false });
      out.playlists += 1;
    }
    const rem = db.prepare(`INSERT INTO reminders(title, key, weekday, time, episode, due, enabled) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(key) DO NOTHING`);
    for (const r of arr(data.reminders)) if (typeof r?.title === 'string') out.reminders += Number(rem.run(r.title, r.key ?? null, r.weekday, r.time, r.episode ?? null, r.due, r.enabled ?? 1).changes);
    const cp = db.prepare('INSERT INTO copies(name, target, created, checked, state) VALUES(?,?,?,?,?) ON CONFLICT(target) DO NOTHING');
    const fl = db.prepare('INSERT OR IGNORE INTO copy_files(copy_id, rel, size, sha, title, drive_serial, src_rel) VALUES(?,?,?,?,?,?,?)');
    for (const c of arr(data.copies)) {
      if (typeof c?.target !== 'string' || typeof c.name !== 'string') continue;
      const made = cp.run(c.name, c.target, c.created ?? 0, c.checked ?? null, c.state ?? null);
      if (!Number(made.changes)) continue;
      for (const f of arr(c.files)) fl.run(Number(made.lastInsertRowid), f.rel, f.size ?? 0, f.sha ?? null, f.title ?? null, f.driveSerial ?? null, f.srcRel ?? null);
      out.copies += 1;
    }
    // an order is the same one when customer and time match
    const dup = db.prepare('SELECT 1 FROM orders WHERE customer_key = ? AND created = ?');
    for (const o of arr(data.orders)) {
      if (!Array.isArray(o?.items) || !Number.isFinite(o.created) || dup.get(orders.customerKey(o.customer), o.created)) continue;
      orders.recordOrder(db, { customer: o.customer, phone: o.phone, note: o.note, items: o.items.filter((i) => typeof i?.ref === 'string' && typeof i.title === 'string'), bytes: o.bytes ?? 0, price: o.price ?? null }, o.created);
      out.orders += 1;
    }
    const rq = db.prepare('INSERT INTO requests(name, key, count, last) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET count = MAX(count, excluded.count), last = MAX(last, excluded.last)');
    for (const r of arr(data.requests)) {
      const key = typeof r?.name === 'string' ? orders.nameKey(r.name) : '';
      if (key && r.name.length <= 100) { rq.run(r.name, key, Math.max(1, Number(r.count) || 1), Number(r.last) || 0); out.requests += 1; }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return out;
}

module.exports = { exportData, importData };
