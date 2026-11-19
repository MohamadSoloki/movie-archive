'use strict';
const { parseFolderName } = require('./pattern.js');

function syncScan(db, { driveSerial, rootRel, scan, patterns }) {
  if (!scan.ok) return 0; // unreadable root must not turn everything into "missing"

  const find = db.prepare('SELECT id, pinned, status FROM locations WHERE drive_serial = ? AND rel_path = ?');
  const insert = db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, parsed_year, season, guessed, is_empty)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`);
  const touch = db.prepare('UPDATE locations SET missing = 0, is_empty = ? WHERE id = ?');
  // a review location whose parse changed (new patterns) is queued again; unchanged ones stay in review
  const reparse = db.prepare(`UPDATE locations SET
    status = CASE WHEN status = 'review' AND (parsed_title IS NOT ?1 OR parsed_year IS NOT ?2) THEN 'pending' ELSE status END,
    parsed_title = ?1, parsed_year = ?2, season = ?3, guessed = ?4 WHERE id = ?5`);
  const unreadable = scan.unreadable || [];
  const setMissing = db.prepare('UPDATE locations SET missing = 1 WHERE id = ?');

  db.exec('BEGIN');
  try {
    const seen = new Set();
    let added = 0;
    for (const e of scan.entries) {
      seen.add(e.relPath);
      const p = parseFolderName(e.titleName ?? e.name, patterns);
      p.season = e.season ?? p.season;
      const row = find.get(driveSerial, e.relPath);
      if (!row) {
        insert.run(driveSerial, e.relPath, e.name, p.title, p.year, p.season, p.by === 'auto' ? 1 : 0, e.isEmpty ? 1 : 0);
        added += 1;
        continue;
      }
      touch.run(e.isEmpty ? 1 : 0, row.id);
      if (!row.pinned && row.status !== 'matched') reparse.run(p.title, p.year, p.season, p.by === 'auto' ? 1 : 0, row.id);
    }
    const prefix = rootRel ? `${rootRel}/` : '';
    for (const r of db.prepare('SELECT id, rel_path FROM locations WHERE drive_serial = ?').all(driveSerial)) {
      const blind = unreadable.some((u) => r.rel_path === u || r.rel_path.startsWith(`${u}/`));
      // a single-folder root is its own rel_path, not a parent of it
      const inRoot = r.rel_path.startsWith(prefix) || (rootRel && r.rel_path.toLowerCase() === rootRel.toLowerCase());
      if (inRoot && !seen.has(r.rel_path) && !blind) setMissing.run(r.id);
    }
    db.exec('COMMIT');
    return added;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { syncScan };
