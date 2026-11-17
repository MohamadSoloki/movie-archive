'use strict';
const { parseFolderName } = require('./pattern.js');

function syncScan(db, { driveSerial, rootRel, scan, patterns }) {
  if (!scan.ok) return; // unreadable root must not turn everything into "missing"

  const find = db.prepare('SELECT id, pinned, status FROM locations WHERE drive_serial = ? AND rel_path = ?');
  const insert = db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, parsed_year, season, guessed, is_empty)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`);
  const touch = db.prepare('UPDATE locations SET missing = 0, is_empty = ? WHERE id = ?');
  const reparse = db.prepare('UPDATE locations SET parsed_title = ?, parsed_year = ?, season = ?, guessed = ? WHERE id = ?');
  const setMissing = db.prepare('UPDATE locations SET missing = 1 WHERE id = ?');

  db.exec('BEGIN');
  try {
    const seen = new Set();
    for (const e of scan.entries) {
      seen.add(e.relPath);
      const p = parseFolderName(e.name, patterns);
      const row = find.get(driveSerial, e.relPath);
      if (!row) {
        insert.run(driveSerial, e.relPath, e.name, p.title, p.year, p.season, p.by === 'auto' ? 1 : 0, e.isEmpty ? 1 : 0);
        continue;
      }
      touch.run(e.isEmpty ? 1 : 0, row.id);
      if (!row.pinned && row.status !== 'matched') reparse.run(p.title, p.year, p.season, p.by === 'auto' ? 1 : 0, row.id);
    }
    const prefix = rootRel ? `${rootRel}/` : '';
    for (const r of db.prepare('SELECT id, rel_path FROM locations WHERE drive_serial = ?').all(driveSerial)) {
      if (r.rel_path.startsWith(prefix) && !seen.has(r.rel_path)) setMissing.run(r.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { syncScan };
