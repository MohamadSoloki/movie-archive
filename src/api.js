'use strict';
const path = require('node:path');
const { getSetting, setSetting } = require('./core/db.js');
const { listDrives: defaultListDrives, refreshDrives, toDriveRel } = require('./core/drives.js');
const { scanFolder, VIDEO } = require('./core/scanner.js');
const { syncScan } = require('./core/sync.js');
const { createOmdb } = require('./core/omdb.js');
const { createJikan } = require('./core/jikan.js');
const { savePoster } = require('./core/posters.js');
const { runQueue } = require('./core/pipeline.js');
const fs = require('node:fs');
const fix = require('./core/fix.js');
const { createTranslator, translateCached, pretranslate } = require('./core/translate.js');
const { forgetSeasons } = require('./core/cache.js');
const { createSearch } = require('./core/search.js');
const { lightOf } = require('./core/library.js');
const tags = require('./core/tags.js');
const transfer = require('./core/transfer.js');
const { createCalendar, isEnded } = require('./core/calendar.js');

const SETTING_KEYS = ['language', 'omdbKey', 'patterns', 'ignore', 'collections', 'translateEmail', 'autoTranslate'];

function createApi({
  db, userDataDir, fetch = globalThis.fetch, listDrives = defaultListDrives,
  openPath = async () => '', openExternal = async () => {},
  updater = { check: async () => ({ state: 'dev' }), install() {} },
  concurrency = 5, translatePause = 700, now = () => Date.now(),
  freeSpace = (dir) => { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; } },
}) {
  const search = createSearch(db);
  const calendar = createCalendar(db);
  const postersDir = path.join(userDataDir, 'posters');
  const key = () => getSetting(db, 'omdbKey');
  const deps = () => ({
    omdb: createOmdb({ apiKey: key(), fetch }),
    jikan: createJikan({ fetch, minGap: 350 }),
    savePoster: (url, k) => savePoster(url, postersDir, k, fetch),
    concurrency,
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

  // ---- copy list: copy-only, sources are read, the target is always outside the archive folders ----

  let transferAbort = null;
  let translating = null;
  const sanitize = (text) => String(text).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || '_';

  async function planTransfer({ keys = [], destDir, name }) {
    const folder = transfer.cleanName(name);
    if (!folder) return { ok: false, error: 'bad_name' };
    if (!destDir || !fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) return { ok: false, error: 'bad_dest' };
    const target = path.join(destDir, folder);
    const drives = await getDrives();
    search.invalidate(); // online flags may have just changed
    const rootOf = new Map(drives.map((d) => [d.serial, d.root]));
    for (const r of db.prepare('SELECT drive_serial, rel_path FROM roots').all()) {
      const root = rootOf.get(r.drive_serial);
      if (root && transfer.isInside(path.join(root, r.rel_path), target)) return { ok: false, error: 'inside_archive' };
    }
    const destDrive = drives.find((d) => transfer.isInside(d.root, destDir))?.serial;
    const jobs = [];
    const skipped = [];
    const used = new Set();
    for (const key of keys) {
      const e = search.find(key);
      if (!e) continue;
      if (e.kind === 'collection') { // the whole folder, as one item
        const c = e.collection;
        const src = rootOf.has(c.driveSerial) ? path.join(rootOf.get(c.driveSerial), c.relPath) : null;
        if (!c.online || !src) { skipped.push({ key, title: e.title, reason: 'offline' }); continue; }
        if (c.missing || !fs.existsSync(src)) { skipped.push({ key, title: e.title, reason: 'missing' }); continue; }
        if (transfer.isInside(src, target)) { skipped.push({ key, title: e.title, reason: 'dest_inside_source' }); continue; }
        let rel = path.basename(c.relPath);
        for (let n = 2; used.has(rel.toLowerCase()); n += 1) rel = `${rel.replace(/ \(\d+\)$/, '')} (${n})`;
        used.add(rel.toLowerCase());
        jobs.push({ key, title: e.title, locationId: null, driveSerial: c.driveSerial, src, dest: path.join(target, rel), bytes: transfer.treeSize(src) });
        continue;
      }
      const { picks, reason } = transfer.pickLocations(e.locations, destDrive);
      if (!picks.length) { skipped.push({ key, title: e.title, reason }); continue; }
      for (const l of picks) {
        const src = path.join(rootOf.get(l.driveSerial), l.relPath);
        if (!fs.existsSync(src)) { skipped.push({ key, title: e.title, reason: 'missing' }); continue; }
        if (transfer.isInside(src, target)) { skipped.push({ key, title: e.title, reason: 'dest_inside_source' }); continue; }
        let rel = l.season == null ? path.basename(l.relPath) : path.join(sanitize(e.title), path.basename(l.relPath));
        for (let n = 2; used.has(rel.toLowerCase()); n += 1) rel = `${rel.replace(/ \(\d+\)$/, '')} (${n})`;
        used.add(rel.toLowerCase());
        jobs.push({ key, title: e.title, locationId: l.id, driveSerial: l.driveSerial, src, dest: path.join(target, rel), bytes: transfer.treeSize(src) });
      }
    }
    if (!jobs.length && !skipped.length) return { ok: false, error: 'nothing' };
    // a film that lies inside a collection folder in the same list is already part of that copy
    for (let i = jobs.length - 1; i >= 0; i -= 1) {
      if (jobs.some((o, j) => j !== i && o.src !== jobs[i].src && transfer.isInside(o.src, jobs[i].src))) jobs.splice(i, 1);
    }
    jobs.sort((a, b) => a.driveSerial.localeCompare(b.driveSerial)); // read one disk at a time, front to back
    const bytes = jobs.reduce((n, j) => n + j.bytes, 0);
    const free = freeSpace(destDir);
    if (bytes > free) return { ok: false, error: 'no_space', needed: bytes, free };
    return { ok: true, target, jobs, skipped, bytes, free };
  }

  async function startTransfer(request, onProgress = () => {}) {
    if (transferAbort) return { ok: false, error: 'busy' };
    const ac = new AbortController();
    transferAbort = ac; // taken before the first await, so a second call sees it
    try {
      return await runTransfer(request, onProgress, ac);
    } finally {
      transferAbort = null;
    }
  }

  async function runTransfer(request, onProgress, ac) {
    const plan = await planTransfer(request);
    if (!plan.ok) return plan;
    if (!plan.jobs.length) return { ok: false, error: 'nothing' };
    const result = { ok: true, done: 0, failed: [], skipped: plan.skipped, cancelled: false, bytes: 0 };
    let doneBytes = 0;
    let last = 0;
    const emit = (index, title, force) => {
      const now = Date.now();
      if (!force && now - last < 250) return;
      last = now;
      onProgress({ type: 'copy', index, total: plan.jobs.length, title, doneBytes, totalBytes: plan.bytes });
    };
    fs.mkdirSync(plan.target, { recursive: true });
    for (const [i, j] of plan.jobs.entries()) {
      if (ac.signal.aborted) break;
      emit(i, j.title, true);
      try {
        const r = await transfer.copyTree(j.src, j.dest, { signal: ac.signal, onBytes: (n) => { doneBytes += n; emit(i, j.title, false); } });
        if (r.cancelled) break;
        result.done += 1;
      } catch (e) {
        result.failed.push({ key: j.key, title: j.title, error: e.code || 'error' });
      }
    }
    result.cancelled = ac.signal.aborted;
    result.bytes = doneBytes;
    onProgress({ type: 'copy', index: plan.jobs.length, total: plan.jobs.length, title: '', doneBytes, totalBytes: plan.bytes });
    return result;
  }

  // the folders a tag lands on: the entry's own, or every film's of a collection
  const tagTargets = (e) => (e.kind === 'collection'
    ? e.members.flatMap((m) => search.find(m.key)?.locations ?? []).map((l) => l.id)
    : e.locations.map((l) => l.id));

  function changeTags(keys, text, apply) {
    const tag = tags.normalizeTag(text);
    if (tag === null) return { ok: false, error: 'empty' };
    if (tag === 'too_long') return { ok: false, error: 'too_long' };
    let count = 0;
    for (const key of keys) {
      const e = search.find(key);
      if (!e) continue;
      apply(db, tagTargets(e), tag);
      count += 1;
    }
    search.invalidate();
    return { ok: true, count };
  }

  function changeTag(key, text, apply) {
    const r = changeTags([key], text, apply);
    return !r.ok ? r : r.count ? { ok: true } : { ok: false, error: 'unknown' };
  }

  const manyTags = (keys, text, apply) => (keys.length ? changeTags(keys, text, apply) : { ok: false, error: 'nothing' });

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
    // Files or folders dropped on the window. A folder becomes a single archive folder; a video file brings its own folder.
    async addDropped(paths) {
      const res = { added: 0, already: 0, failed: [] };
      const online = (await getDrives()).filter((d) => d.online);
      const roots = db.prepare('SELECT drive_serial, rel_path, single FROM roots').all();
      for (const p of paths) {
        let st;
        try { st = fs.statSync(p); } catch { res.failed.push({ path: p, error: 'not_found' }); continue; }
        if (st.isFile() && !VIDEO.has(path.extname(p).slice(1).toLowerCase())) { res.failed.push({ path: p, error: 'not_media' }); continue; }
        if (!st.isFile() && !st.isDirectory()) { res.failed.push({ path: p, error: 'not_found' }); continue; }
        const dir = st.isFile() ? path.dirname(p) : p;
        const hit = toDriveRel(online, dir);
        if (!hit) { res.failed.push({ path: p, error: 'no_drive' }); continue; }
        const low = hit.relPath.toLowerCase();
        const covered = roots.some((r) => r.drive_serial === hit.serial && (r.single
          ? r.rel_path.toLowerCase() === low
          : !r.rel_path || low === r.rel_path.toLowerCase() || low.startsWith(`${r.rel_path.toLowerCase()}/`)));
        if (covered) { res.already += 1; continue; }
        const r = await this.addRoot(dir, true);
        if (!r.ok) { res.failed.push({ path: p, error: r.error }); continue; }
        roots.push({ drive_serial: hit.serial, rel_path: hit.relPath, single: 1 });
        res.added += 1;
      }
      return res;
    },
    async removeRoot(id) {
      const root = db.prepare('SELECT drive_serial, rel_path, single FROM roots WHERE id = ?').get(id);
      if (!root) return;
      const prefix = root.rel_path ? `${root.rel_path}/` : '';
      db.exec('BEGIN');
      try {
        const drop = db.prepare('DELETE FROM locations WHERE id = ?');
        for (const l of db.prepare('SELECT id, rel_path FROM locations WHERE drive_serial = ?').all(root.drive_serial)) {
          if (l.rel_path.startsWith(prefix) || (root.single && l.rel_path.toLowerCase() === root.rel_path.toLowerCase())) drop.run(l.id);
        }
        for (const o of db.prepare('SELECT id FROM titles WHERE id NOT IN (SELECT title_id FROM locations WHERE title_id IS NOT NULL)').all()) forgetSeasons(db, o.id);
        db.exec('DELETE FROM titles WHERE id NOT IN (SELECT title_id FROM locations WHERE title_id IS NOT NULL)');
        db.exec('DELETE FROM episodes WHERE title_id NOT IN (SELECT id FROM titles)');
        db.exec('DELETE FROM tags WHERE location_id NOT IN (SELECT id FROM locations)');
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
    // light: the grid only needs small entries; the whole one comes from getEntry when a card is opened
    async getEntries(opts = {}) {
      const r = search.query(opts);
      return opts.light ? { ...r, entries: r.entries.map(lightOf) } : r;
    },
    async getEntry(key) {
      return search.find(key);
    },
    // manual tags belong to the folders of an entry, so they survive rescans and online fixes
    async addTag(key, text) {
      return changeTag(key, text, tags.addTag);
    },
    async removeTag(key, text) {
      return changeTag(key, text, tags.removeTag);
    },
    planTransfer,
    startTransfer,
    async cancelTransfer() {
      transferAbort?.abort();
    },
    async addTags(keys, text) {
      return manyTags(keys, text, tags.addTag);
    },
    async removeTags(keys, text) {
      return manyTags(keys, text, tags.removeTag);
    },
    async getTags() {
      return search.tagList();
    },
    // ---- series calendar ----
    async calendarList() {
      return calendar.list(now());
    },
    async calendarAdd(data) {
      let title = data.title;
      if (data.key) {
        const e = search.find(data.key);
        if (!e) return { ok: false, error: 'unknown' };
        title = title || e.title;
      }
      return calendar.add({ ...data, title }, now());
    },
    async calendarUpdate(id, patch) {
      return calendar.update(id, patch, now());
    },
    async calendarTick(id) {
      return calendar.tick(id, now());
    },
    async calendarSkip(id) {
      return calendar.skip(id);
    },
    async calendarRemove(id) {
      calendar.remove(id);
      return { ok: true };
    },
    // a series (or anime) that OMDb does not say has finished can be put on the calendar
    async getAiring(key) {
      const e = search.find(key);
      const ended = !!e && isEnded(e.year);
      const canAir = !!e && (e.kind === 'series' || e.type === 'anime') && !ended;
      return { canAir, ended, reminder: calendar.forKey(key) };
    },
    async getEpisodes(titleId) {
      const seasons = new Map();
      for (const e of db.prepare('SELECT season, number, name, released, rating, plot FROM episodes WHERE title_id = ? ORDER BY season, number').all(titleId)) {
        if (!seasons.has(e.season)) seasons.set(e.season, { season: e.season, episodes: [] });
        seasons.get(e.season).episodes.push({ number: e.number, name: e.name, released: e.released, rating: e.rating, plot: e.plot || null });
      }
      return [...seasons.values()];
    },
    // translates stored plots in the background; the renderer starts it on launch and from the settings
    async startPretranslate(onProgress = () => {}) {
      if (translating) return { ok: false, error: 'busy' };
      translating = new AbortController();
      try {
        const translator = createTranslator({ fetch, email: getSetting(db, 'translateEmail') });
        const r = await pretranslate(db, translator, {
          pause: translatePause, signal: translating.signal, onProgress: (p) => onProgress({ type: 'translate', ...p }),
        });
        return { ok: true, ...r };
      } finally {
        translating = null;
      }
    },
    async stopPretranslate() {
      translating?.abort();
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
    checkUpdate: () => updater.check(),
    installUpdate() { updater.install(); },
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
