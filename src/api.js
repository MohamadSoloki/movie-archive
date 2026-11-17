'use strict';
const path = require('node:path');
const { getSetting, setSetting } = require('./core/db.js');
const { listDrives: defaultListDrives, refreshDrives, toDriveRel } = require('./core/drives.js');
const { scanFolder } = require('./core/scanner.js');
const { syncScan } = require('./core/sync.js');
const { createOmdb } = require('./core/omdb.js');
const { createJikan } = require('./core/jikan.js');
const { savePoster } = require('./core/posters.js');
const { runQueue } = require('./core/pipeline.js');
const fix = require('./core/fix.js');
const { createSearch } = require('./core/search.js');

const SETTING_KEYS = ['language', 'omdbKey', 'patterns', 'ignore', 'collections'];

function createApi({ db, userDataDir, fetch = globalThis.fetch, listDrives = defaultListDrives }) {
  const search = createSearch(db);
  const postersDir = path.join(userDataDir, 'posters');
  const key = () => getSetting(db, 'omdbKey');
  const deps = () => ({
    omdb: createOmdb({ apiKey: key(), fetch }),
    jikan: createJikan({ fetch }),
    savePoster: (url, k) => savePoster(url, postersDir, k, fetch),
  });
  const pendingCount = () => db.prepare("SELECT COUNT(*) c FROM locations WHERE status = 'pending' AND missing = 0").get().c;

  async function getDrives() {
    try {
      refreshDrives(db, await listDrives());
    } catch {
      // drive listing failed: keep the last known online state rather than marking everything offline
    }
    return db.prepare('SELECT serial, label, root, online FROM drives ORDER BY label').all()
      .map((d) => ({ ...d, online: !!d.online }));
  }

  async function fixLocation(target, link) {
    if (!key()) return { ok: false, error: 'bad_key' };
    const r = await fix.applyFix(db, target, link, deps());
    search.invalidate();
    return r;
  }

  return {
    async getSettings() {
      return Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(db, k)]));
    },
    async setSettings(partial) {
      for (const k of SETTING_KEYS) if (k in partial) setSetting(db, k, partial[k]);
      search.invalidate();
    },
    getDrives,
    async addRoot(absPath) {
      const hit = toDriveRel((await getDrives()).filter((d) => d.online), absPath);
      if (!hit) return { ok: false, error: 'no_drive' };
      db.prepare('INSERT OR IGNORE INTO roots(drive_serial, rel_path) VALUES(?, ?)').run(hit.serial, hit.relPath);
      return { ok: true };
    },
    async removeRoot(id) {
      const root = db.prepare('SELECT drive_serial, rel_path FROM roots WHERE id = ?').get(id);
      if (!root) return;
      const prefix = root.rel_path ? `${root.rel_path}/` : '';
      db.exec('BEGIN');
      try {
        for (const l of db.prepare('SELECT id, rel_path FROM locations WHERE drive_serial = ?').all(root.drive_serial)) {
          if (l.rel_path.startsWith(prefix)) db.prepare('DELETE FROM locations WHERE id = ?').run(l.id);
        }
        db.exec('DELETE FROM titles WHERE id NOT IN (SELECT title_id FROM locations WHERE title_id IS NOT NULL)');
        db.prepare('DELETE FROM roots WHERE id = ?').run(id);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      search.invalidate();
    },
    async getRoots() {
      return db.prepare(`SELECT r.id, r.drive_serial AS driveSerial, d.label AS driveLabel, r.rel_path AS relPath,
        COALESCE(d.online, 0) AS online FROM roots r LEFT JOIN drives d ON d.serial = r.drive_serial ORDER BY r.id`).all()
        .map((r) => ({ ...r, driveLabel: r.driveLabel || '', online: !!r.online }));
    },
    async scan() {
      await getDrives();
      const roots = db.prepare(`SELECT r.drive_serial, r.rel_path, d.root FROM roots r
        JOIN drives d ON d.serial = r.drive_serial WHERE d.online = 1`).all();
      const opts = { ignore: getSetting(db, 'ignore'), collections: getSetting(db, 'collections') };
      const patterns = getSetting(db, 'patterns');
      for (const r of roots) {
        const scan = scanFolder(path.join(r.root, r.rel_path), r.rel_path, opts);
        syncScan(db, { driveSerial: r.drive_serial, rootRel: r.rel_path, scan, patterns });
      }
      search.invalidate();
      return { scanned: roots.length };
    },
    async startQueue(onProgress) {
      if (!key()) return { processed: 0, remaining: pendingCount(), stoppedBy: 'bad_key' };
      const r = await runQueue(db, deps(), onProgress);
      search.invalidate();
      return r;
    },
    async getEntries(query = '') {
      return search.query(query);
    },
    applyFix: fixLocation,
    async getCandidates(locationId) {
      if (!key()) return { ok: false, error: 'bad_key' };
      try {
        return { ok: true, candidates: await fix.getCandidates(db, locationId, deps()) };
      } catch (e) {
        if (e.kind) return { ok: false, error: e.kind };
        throw e;
      }
    },
    async pickCandidate(locationId, imdbId) {
      return fixLocation({ locationId }, imdbId);
    },
    posterPath(file) {
      return path.join(postersDir, path.basename(file));
    },
  };
}

module.exports = { createApi };
