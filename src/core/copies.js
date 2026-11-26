'use strict';
const path = require('node:path');

// Finished copies the app made, kept so they can be checked and repaired later. A record only describes files in the
// destination; removing it never touches them. `rel` is the path inside `target`, always with "/".

const destOf = (target, rel) => path.join(target, ...rel.split('/'));

function saveCopy(db, { name, target, files }, now) {
  let row = db.prepare('SELECT id FROM copies WHERE target = ?').get(target);
  if (!row) row = { id: Number(db.prepare('INSERT INTO copies(name, target, created) VALUES(?,?,?)').run(name, target, now).lastInsertRowid) };
  const ins = db.prepare(`INSERT INTO copy_files(copy_id, rel, size, sha, title, drive_serial, src_rel) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(copy_id, rel) DO UPDATE SET size = excluded.size, sha = COALESCE(excluded.sha, copy_files.sha),
      title = excluded.title, drive_serial = excluded.drive_serial, src_rel = excluded.src_rel`);
  for (const f of files) ins.run(row.id, f.rel, f.size, f.sha ?? null, f.title, f.driveSerial, f.srcRel);
  db.prepare('UPDATE copies SET name = ?, checked = NULL, state = NULL WHERE id = ?').run(name, row.id); // the file set changed: no verdict yet
  return row.id;
}

function listCopies(db, { after = null, until = null } = {}) {
  return db.prepare(`SELECT c.id, c.name, c.target, c.created, c.checked, c.state, c.last_success lastSuccess,
    COUNT(f.rel) files, COALESCE(SUM(f.size), 0) bytes
    FROM copies c LEFT JOIN copy_files f ON f.copy_id = c.id
    WHERE (? IS NULL OR (c.last_success > ? AND c.last_success <= ?))
    GROUP BY c.id ORDER BY COALESCE(c.last_success, c.created) DESC, c.id DESC`).all(after, after, until);
}

function markSuccessful(db, id, now) {
  db.prepare('UPDATE copies SET last_success = ? WHERE id = ?').run(now, id);
}

function copyFiles(db, id) {
  return db.prepare('SELECT rel, size, sha, title, drive_serial driveSerial, src_rel srcRel FROM copy_files WHERE copy_id = ? ORDER BY rowid').all(id);
}

function markChecked(db, id, state, now) {
  db.prepare('UPDATE copies SET state = ?, checked = ? WHERE id = ?').run(state, now, id);
}

function removeCopy(db, id) {
  db.prepare('DELETE FROM copy_files WHERE copy_id = ?').run(id);
  db.prepare('DELETE FROM copies WHERE id = ?').run(id);
}

// verifyFiles problems ({dest, reason}) grouped by the film or series each file belongs to, in the order of the copy
function problemsByTitle(files, target, problems) {
  const reason = new Map(problems.map((p) => [p.dest, p.reason]));
  const groups = new Map();
  for (const f of files) {
    const r = reason.get(destOf(target, f.rel));
    if (!r) continue;
    if (!groups.has(f.title)) groups.set(f.title, { title: f.title, files: [] });
    groups.get(f.title).files.push({ rel: f.rel, reason: r });
  }
  return [...groups.values()];
}

module.exports = { saveCopy, listCopies, copyFiles, markChecked, markSuccessful, removeCopy, problemsByTitle, destOf };
