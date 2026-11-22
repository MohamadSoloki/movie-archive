'use strict';
const { setSetting } = require('./db.js');

const FORMAT = 'movie-archive-backup';
// what the owner made by hand, so a new computer or a wiped database can get it back; the archive itself is rescanned.
// The OMDb key stays out: a backup file gets copied around.
const SECRET = new Set(['omdbKey']);

// node:sqlite rows have no prototype; plain objects compare and serialise the same everywhere
const plain = (rows) => rows.map((r) => ({ ...r }));

function exportData(db, { now = Date.now() } = {}) {
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
    reminders: plain(db.prepare('SELECT title, key, weekday, time, episode, due, enabled FROM reminders ORDER BY id').all()),
    copies,
  };
}

// Merges a backup into the database: settings are overwritten, everything else is added when missing, so importing twice
// changes nothing. Tags and aliases go to the folder with the same drive and path; those this machine does not have are counted.
function importData(db, data) {
  if (!data || typeof data !== 'object' || data.format !== FORMAT) throw new Error('not_a_backup');
  const out = { tags: 0, aliases: 0, reminders: 0, copies: 0, skipped: 0 };
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
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return out;
}

module.exports = { exportData, importData };
