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
const fs = require('node:fs');
const fix = require('./core/fix.js');
const { createTranslator, translateCached } = require('./core/translate.js');
const { forgetSeasons } = require('./core/cache.js');
const { createSearch } = require('./core/search.js');

const SETTING_KEYS = ['language', 'omdbKey', 'patterns', 'ignore', 'collections', 'translateEmail'];

function createApi({
  db, userDataDir, fetch = globalThis.fetch, listDrives = defaultListDrives,
  openPath = async () => '', openExternal = async () => {},
}) {
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

  // Opens a stored folder in the file manager. A file (one film inside a collection folder) opens the folder that holds it.
  async function openRel(serial, relPath) {
    const d = db.prepare('SELECT root, online FROM drives WHERE serial = ?').get(serial);
    // the stored online flag can be stale: the drive may have been unplugged since the last refresh
    if (!d || !d.online || !fs.existsSync(d.root)) return { ok: false, error: 'offline' };
    let abs = path.join(d.root, relPath);
    if (!fs.existsSync(abs)) return { ok: false, error: 'missing' };
    if (fs.statSync(abs).isFile()) abs = path.dirname(abs);
    // shell.openPath answers with an error text, or '' on success
    return (await openPath(abs)) ? { ok: false, error: 'missing' } : { ok: true };
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
    // single = this one folder is a title (or a series), not a folder that holds titles
    async addRoot(absPath, single = false) {
      const hit = toDriveRel((await getDrives()).filter((d) => d.online), absPath);
      if (!hit) return { ok: false, error: 'no_drive' };
      if (single) {
        if (!hit.relPath) return { ok: false, error: 'drive_root' };
        let isDir = false;
        try { isDir = fs.statSync(absPath).isDirectory(); } catch { /* not there */ }
        if (!isDir) return { ok: false, error: 'not_folder' };
      }
      db.prepare('INSERT OR IGNORE INTO roots(drive_serial, rel_path, single) VALUES(?, ?, ?)').run(hit.serial, hit.relPath, single ? 1 : 0);
      return { ok: true };
    },
    async removeRoot(id) {
      const root = db.prepare('SELECT drive_serial, rel_path, single FROM roots WHERE id = ?').get(id);
      if (!root) return;
      const prefix = root.rel_path ? `${root.rel_path}/` : '';
      db.exec('BEGIN');
      try {
        for (const l of db.prepare('SELECT id, rel_path FROM locations WHERE drive_serial = ?').all(root.drive_serial)) {
          if (l.rel_path.startsWith(prefix) || (root.single && l.rel_path.toLowerCase() === root.rel_path.toLowerCase())) db.prepare('DELETE FROM locations WHERE id = ?').run(l.id);
        }
        for (const o of db.prepare('SELECT id FROM titles WHERE id NOT IN (SELECT title_id FROM locations WHERE title_id IS NOT NULL)').all()) forgetSeasons(db, o.id);
        db.exec('DELETE FROM titles WHERE id NOT IN (SELECT title_id FROM locations WHERE title_id IS NOT NULL)');
        db.exec('DELETE FROM episodes WHERE title_id NOT IN (SELECT id FROM titles)');
        db.prepare('DELETE FROM roots WHERE id = ?').run(id);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      search.invalidate();
    },
    async getRoots() {
      return db.prepare(`SELECT r.id, r.drive_serial AS driveSerial, d.label AS driveLabel, r.rel_path AS relPath, r.single,
        COALESCE(d.online, 0) AS online FROM roots r LEFT JOIN drives d ON d.serial = r.drive_serial ORDER BY r.id`).all()
        .map((r) => ({ ...r, driveLabel: r.driveLabel || '', online: !!r.online, single: !!r.single }));
    },
    async scan() {
      await getDrives();
      const roots = db.prepare(`SELECT r.drive_serial, r.rel_path, r.single, d.root FROM roots r
        JOIN drives d ON d.serial = r.drive_serial WHERE d.online = 1`).all();
      const opts = { ignore: getSetting(db, 'ignore'), collections: getSetting(db, 'collections') };
      const patterns = getSetting(db, 'patterns');
      let added = 0;
      for (const r of roots) {
        let scan;
        if (r.single) { // scan the parent, keeping only this folder
          const i = r.rel_path.lastIndexOf('/');
          const parent = i < 0 ? '' : r.rel_path.slice(0, i);
          scan = scanFolder(path.join(r.root, parent), parent, { ...opts, only: r.rel_path.slice(i + 1) });
        } else {
          scan = scanFolder(path.join(r.root, r.rel_path), r.rel_path, opts);
        }
        added += syncScan(db, { driveSerial: r.drive_serial, rootRel: r.rel_path, scan, patterns });
      }
      search.invalidate();
      return { scanned: roots.length, added };
    },
    async startQueue(onProgress) {
      if (!key()) return { processed: 0, remaining: pendingCount(), stoppedBy: 'bad_key', episodes: 0 };
      const r = await runQueue(db, deps(), onProgress);
      search.invalidate();
      return r;
    },
    async getEntries(opts = {}) {
      return search.query(opts);
    },
    async getEpisodes(titleId) {
      const seasons = new Map();
      for (const e of db.prepare('SELECT season, number, name, released, rating, plot FROM episodes WHERE title_id = ? ORDER BY season, number').all(titleId)) {
        if (!seasons.has(e.season)) seasons.set(e.season, { season: e.season, episodes: [] });
        seasons.get(e.season).episodes.push({ number: e.number, name: e.name, released: e.released, rating: e.rating, plot: e.plot || null });
      }
      return [...seasons.values()];
    },
    async translate(text) {
      try {
        const translator = createTranslator({ fetch, email: getSetting(db, 'translateEmail') });
        return { ok: true, text: await translateCached(db, translator, text) };
      } catch (e) {
        if (e.kind) return { ok: false, error: e.kind };
        throw e;
      }
    },
    async openLocation(locationId) {
      const l = db.prepare('SELECT drive_serial, rel_path FROM locations WHERE id = ?').get(locationId);
      return l ? openRel(l.drive_serial, l.rel_path) : { ok: false, error: 'unknown' };
    },
    // only a folder that some stored location names as its collection can be opened this way
    async openCollection(driveSerial, relPath) {
      const known = db.prepare('SELECT 1 FROM locations WHERE drive_serial = ? AND collection = ?').get(driveSerial, relPath);
      return known ? openRel(driveSerial, relPath) : { ok: false, error: 'unknown' };
    },
    async openImdb(titleId) {
      const id = db.prepare('SELECT imdb_id FROM titles WHERE id = ?').get(titleId)?.imdb_id;
      if (!/^tt\d{7,10}$/.test(id || '')) return { ok: false };
      await openExternal(`https://www.imdb.com/title/${id}/`);
      return { ok: true };
    },
    applyFix: fixLocation,
    async getCandidates(locationId, query = '') {
      if (!key()) return { ok: false, error: 'bad_key' };
      try {
        return { ok: true, candidates: await fix.getCandidates(db, locationId, deps(), query) };
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
