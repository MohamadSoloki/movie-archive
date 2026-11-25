'use strict';
const path = require('node:path');
const os = require('node:os');
const { genreLabel } = require('./renderer/i18n.js');
const { getSetting, setSetting } = require('./core/db.js');
const { listDrivesHere: defaultListDrives, refreshDrives, toDriveRel, listRemovableHere: defaultListRemovable, ejectDrive: defaultEject } = require('./core/drives.js');
const { scanFolder, VIDEO } = require('./core/scanner.js');
const { syncScan } = require('./core/sync.js');
const { createOmdb } = require('./core/omdb.js');
const { createJikan } = require('./core/jikan.js');
const { savePoster } = require('./core/posters.js');
const { runQueue } = require('./core/pipeline.js');
const fs = require('node:fs');
const fix = require('./core/fix.js');
const { createTranslator, translateCached, pretranslate } = require('./core/translate.js');
const { forgetSeasons, getCache, putCache, cached } = require('./core/cache.js');
const { createSearch } = require('./core/search.js');
const { lightOf, badgesOf } = require('./core/library.js');
const { createCatalogServer } = require('./core/catalog-server.js');
const { createTunnel } = require('./core/tunnel.js');
const tags = require('./core/tags.js');
const transfer = require('./core/transfer.js');
const { createCalendar, isEnded } = require('./core/calendar.js');
const copies = require('./core/copies.js');
const { verifyFiles } = require('./core/verify.js');
const { createRate } = require('./core/rate.js');
const { similarTo } = require('./core/similar.js');
const playlists = require('./core/playlists.js');
const { relatedTo, relatedMap, franchiseKey } = require('./core/related');
const { seriesGaps } = require('./core/gaps.js');
const { singleDrive, catalogByGenre, duplicates } = require('./core/reports.js');
const { exportData, importData } = require('./core/backup.js');
const orders = require('./core/orders.js');
const { normalizeFa } = require('./core/persian.js');
const { diffWish, saveWish } = require('./core/lists.js');
const { episodesIn, episodeFilter } = require('./core/seasons.js');
const { ProviderError } = require('./core/errors.js');
// the first private-network address of this computer: what a phone on the same Wi-Fi can reach
function defaultLanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '127.0.0.1';
}
const defaultQr = (text) => require('qrcode').toDataURL(text, { margin: 1, width: 240 });

const WISH_LIMIT = 300;
// words of a folder name that say how the copy is, not what the film is called
const NOT_A_NAME = new Set(['دوبله', 'فارسی', 'زیرنویس', 'چسبیده', 'فصل', 'قسمت', 'دو', 'زبانه', 'کامل', 'سریال', 'فیلم']);
// Persian film names kept in folder names, so a customer typing the Persian name finds a film OMDb knows in English
function persianNames(e) {
  const out = new Set();
  for (const l of e.locations) {
    for (const m of l.folderName.matchAll(/[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)*/g)) {
      const words = m[0].split(/\s+/).filter((w) => !NOT_A_NAME.has(w));
      if (words.length) out.add(words.join(' '));
    }
  }
  return [...out];
}

// what the phone page gets for one film: names, genres and ratings only; nothing about folders or drives
function catalogRow(e, lang) {
  const seasons = new Set(e.locations.filter((l) => !l.missing && l.season).map((l) => String(l.season))).size;
  const na = (v) => (v && v !== 'N/A' ? v : null);
  return {
    k: e.key, t: e.title, f: e.persianName ?? null, y: e.year ?? null, g: e.genreList.map((g) => genreLabel(lang, g)), r: na(e.rating), b: badgesOf(e.quality),
    a: [...e.aliases, ...persianNames(e), ...[na(e.director), na(e.actors)].filter(Boolean)], p: !!e.posterFile,
    kd: e.section ?? (e.kind === 'other' ? 'anime' : e.kind), s: e.kind === 'series' ? seasons : 0, o: e.addedOrder, d: na(e.director),
  };
}

// "The Batman!" and "the batman" are the same name
const nameKey = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const SETTING_KEYS = ['language', 'omdbKey', 'patterns', 'ignore', 'collections', 'translateEmail', 'autoTranslate', 'priceMovie', 'priceSeason', 'priceEpisode', 'shopName', 'phoneCatalog', 'phoneInternet', 'catalogPort'];
const PRICE_KEYS = ['priceMovie', 'priceSeason', 'priceEpisode'];

function createApi({
  db, userDataDir, fetch = globalThis.fetch, listDrives = defaultListDrives, listRemovable = defaultListRemovable, eject = defaultEject,
  openPath = async () => '', openExternal = async () => {},
  updater = { check: async () => ({ state: 'dev' }), download: async () => ({ state: 'dev' }), install() {} },
  concurrency = 5, translatePause = 700, now = () => Date.now(), clock = () => Date.now(), version = '',
  qr = defaultQr, lanAddress = defaultLanAddress, tunnel = createTunnel({ dir: path.join(userDataDir, 'bin') }),
  freeSpace = (dir) => { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; } },
}) {
  const search = createSearch(db);
  const calendar = createCalendar(db);
  const postersDir = path.join(userDataDir, 'posters');
  const jikan = createJikan({ fetch, minGap: 350 });
  const key = () => getSetting(db, 'omdbKey');
  const deps = () => ({
    omdb: createOmdb({ apiKey: key(), fetch }),
    jikan,
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

  const priceSettings = () => ({ priceMovie: getSetting(db, 'priceMovie'), priceSeason: getSetting(db, 'priceSeason'), priceEpisode: getSetting(db, 'priceEpisode') });

  // How a title is told apart across rescans and fixes: imdb id, MyAnimeList id, or its name and year
  function refOfEntry(e) {
    if (e.imdbId) return e.imdbId;
    const mal = e.titleId != null ? db.prepare('SELECT mal_id FROM titles WHERE id = ?').get(e.titleId)?.mal_id : null;
    return mal ? `mal:${mal}` : `n:${orders.nameKey(e.title)}|${e.year ?? ''}`;
  }

  // the titles one finished copy job handed over: a collection folder hands over each film in it
  function itemsOfJob(j) {
    const e = search.find(j.key);
    if (!e) return [];
    const item = (x, detail) => ({ ref: refOfEntry(x), title: x.title, year: x.year, kind: x.kind, detail });
    if (e.kind === 'collection') return e.members.map((m) => search.find(m.key)).filter(Boolean).map((x) => item(x, ''));
    return [item(e, j.season != null ? path.basename(j.src) + (j.only ? ` (E${j.only.join(',')})` : '') : '')];
  }

  // What the customer chose of a series: { seasons: [1, 2], episodes: { 3: [1, 2, 5] } }. No choice = everything.
  // Returns the locations to copy, each with `only` (episode numbers) when just some episodes of that season are wanted.
  const cleanPick = (p) => {
    const nums = (a) => [...new Set((Array.isArray(a) ? a : []).filter((n) => Number.isInteger(n) && n > 0 && n < 10000))].slice(0, 1000);
    const episodes = {};
    for (const [s, list] of Object.entries(p?.episodes && typeof p.episodes === 'object' ? p.episodes : {})) if (/^\d{1,4}$/.test(s) && nums(list).length) episodes[Number(s)] = nums(list);
    return { seasons: nums(p?.seasons), episodes };
  };
  function chosenLocations(e, picks, destDrive, rootOf) {
    const { picks: locs, reason } = transfer.pickLocations(e.locations, destDrive);
    const sel = picks?.[e.key] ? cleanPick(picks[e.key]) : null;
    if (!sel) return { chosen: locs.map((l) => ({ l, only: null })), reason };
    const chosen = [];
    for (const l of locs) {
      if (l.season == null) { chosen.push({ l, only: null }); continue; }
      const n = Number(l.season);
      if (sel.seasons.includes(n)) { chosen.push({ l, only: null }); continue; }
      if (!sel.episodes[n]) continue;
      const have = rootOf.has(l.driveSerial) ? episodesIn(path.join(rootOf.get(l.driveSerial), l.relPath)) : null;
      const only = have ? sel.episodes[n].filter((x) => have.includes(x)) : [];
      if (only.length) chosen.push({ l, only });
    }
    return { chosen, reason };
  }

  async function planTransfer({ keys = [], destDir, name, skipSpaceCheck = false, picks = null }) {
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
        jobs.push({ key, title: e.title, locationId: null, season: null, driveSerial: c.driveSerial, srcRoot: rootOf.get(c.driveSerial), src, dest: path.join(target, rel), bytes: transfer.treeSize(src) });
        continue;
      }
      const { chosen, reason } = chosenLocations(e, picks, destDrive, rootOf);
      if (!chosen.length) { skipped.push({ key, title: e.title, reason: reason ?? 'no_episodes' }); continue; } // a choice nothing on disk matches is said, not dropped
      for (const { l, only } of chosen) {
        const src = path.join(rootOf.get(l.driveSerial), l.relPath);
        if (!fs.existsSync(src)) { skipped.push({ key, title: e.title, reason: 'missing' }); continue; }
        if (transfer.isInside(src, target)) { skipped.push({ key, title: e.title, reason: 'dest_inside_source' }); continue; }
        let rel = l.season == null ? path.basename(l.relPath) : path.join(sanitize(e.title), path.basename(l.relPath));
        for (let n = 2; used.has(rel.toLowerCase()); n += 1) rel = `${rel.replace(/ \(\d+\)$/, '')} (${n})`;
        used.add(rel.toLowerCase());
        jobs.push({ key, title: e.title, locationId: l.id, season: l.season ?? null, driveSerial: l.driveSerial, srcRoot: rootOf.get(l.driveSerial), src, dest: path.join(target, rel),
          bytes: transfer.treeSize(src, only ? episodeFilter(only) : undefined), ...(only ? { only, episodes: only.length } : {}) });
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
    if (!skipSpaceCheck && bytes > free) return { ok: false, error: 'no_space', needed: bytes, free };
    return { ok: true, target, jobs, skipped, bytes, free, price: orders.priceOf(jobs, priceSettings()) };
  }

  // remove the empty folders left under `dir` (children first), then `dir` itself and its empty parents up to, not including, `stop`
  function pruneEmpty(dir, stop) {
    const walk = (d) => {
      let names;
      try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const n of names) {
        if (!n.isDirectory()) continue;
        walk(path.join(d, n.name));
        try { fs.rmdirSync(path.join(d, n.name)); } catch { /* not empty */ }
      }
    };
    walk(dir);
    for (let d = dir; d.length > stop.length; d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { break; } }
  }

  let liveTransfer = null; // the running copy's list, see updateTransfer

  // Copy, verify and repair share one slot: only one of them runs at a time, and cancelTransfer stops whichever it is.
  async function exclusive(run) {
    if (transferAbort) return { ok: false, error: 'busy' };
    const ac = new AbortController();
    transferAbort = ac; // taken before the first await, so a second call sees it
    try {
      return await run(ac);
    } finally {
      transferAbort = null;
    }
  }

  // the drive a folder lives on, the key of the speed memory
  const driveOf = (dir) => path.parse(path.resolve(dir)).root.toLowerCase();

  const startTransfer = (request, onProgress = () => {}) => exclusive((ac) => runTransfer(request, onProgress, ac));

  async function runTransfer(request, onProgress, ac) {
    const plan = await planTransfer(request);
    if (!plan.ok) return plan;
    if (!plan.jobs.length) return { ok: false, error: 'nothing' };
    const result = { ok: true, done: 0, failed: [], skipped: plan.skipped, cancelled: false, bytes: 0 };
    const manifest = [];
    const okJobs = [];
    let doneBytes = 0;
    let last = 0;
    const rate = createRate();
    const startedAt = clock();
    // The list of jobs can change while the copy runs (updateTransfer): `queue` is what is still to do, `current` the one being copied.
    const queue = plan.jobs.slice();
    const doneKeys = new Set();
    let totalBytes = plan.bytes;
    let finished = 0;
    let current = null;
    const pending = new Set();
    const emit = (index, title, force) => {
      const at = clock();
      if (!force && at - last < 250) return;
      last = at;
      onProgress({ type: 'copy', index, total: finished + queue.length + (current ? 1 : 0), title, doneBytes, totalBytes, ...rate.sample(at, doneBytes, totalBytes) });
    };
    liveTransfer = {
      request,
      remove(keys) {
        const gone = new Set(keys);
        let removed = 0;
        const kept = [];
        for (let i = queue.length - 1; i >= 0; i -= 1) {
          if (gone.has(queue[i].key)) { totalBytes -= queue[i].bytes; queue.splice(i, 1); removed += 1; }
        }
        if (current && gone.has(current.job.key)) { current.stop.abort(); current.removed = true; removed += 1; }
        for (const k of gone) if (doneKeys.has(k)) kept.push(k);
        return { removed, kept };
      },
      async add(keys, picks = null) {
        const have = new Set([...doneKeys, ...queue.map((j) => j.key), ...(current ? [current.job.key] : [])]);
        const fresh = keys.filter((k) => !have.has(k));
        // planned together with the films already in this copy, so folder names are chosen the same way and never collide
        const planned = await planTransfer({ ...request, keys: [...have, ...fresh], picks: { ...request.picks, ...picks }, skipSpaceCheck: true });
        if (!planned.ok) return 0;
        const jobs = planned.jobs.filter((j) => fresh.includes(j.key));
        queue.push(...jobs);
        totalBytes += jobs.reduce((n, j) => n + j.bytes, 0);
        return new Set(jobs.map((j) => j.key)).size;
      },
      track(promise) { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; },
    };
    fs.mkdirSync(plan.target, { recursive: true });
    for (;;) {
      if (!queue.length) {
        if (!pending.size) break;
        await Promise.allSettled([...pending]); // an update that is still being planned may add films
        continue;
      }
      const j = queue.shift();
      if (ac.signal.aborted) break;
      const stop = new AbortController();
      const onAbort = () => stop.abort();
      ac.signal.addEventListener('abort', onAbort);
      current = { job: j, stop, removed: false };
      const i = finished;
      emit(i, j.title, true);
      let copiedHere = 0;
      try {
        const r = await transfer.copyTree(j.src, j.dest, { signal: stop.signal, filter: j.only ? episodeFilter(j.only) : undefined, onBytes: (n) => { doneBytes += n; copiedHere += n; emit(i, j.title, false); } });
        if (current.removed) { // taken off the list while it was being copied: what this job wrote is taken away again
          for (const f of r.files) fs.rmSync(f.dest, { force: true });
          doneBytes -= copiedHere;
          totalBytes -= j.bytes;
          pruneEmpty(j.dest, plan.target);
          continue;
        }
        for (const f of r.files) {
          manifest.push({ rel: path.relative(plan.target, f.dest).split(path.sep).join('/'), size: f.size, sha: f.sha, title: j.title,
            driveSerial: j.driveSerial, srcRel: path.relative(j.srcRoot, f.src).split(path.sep).join('/') });
        }
        if (r.cancelled) break;
        result.done += 1;
        finished += 1;
        doneKeys.add(j.key);
        okJobs.push(j);
      } catch (e) {
        result.failed.push({ key: j.key, title: j.title, error: e.code || 'error' });
        finished += 1;
      } finally {
        ac.signal.removeEventListener('abort', onAbort);
        current = null;
      }
    }
    liveTransfer = null;
    result.cancelled = ac.signal.aborted;
    result.bytes = doneBytes;
    const seconds = (clock() - startedAt) / 1000;
    if (!result.cancelled && doneBytes > 0 && seconds > 0) {
      setSetting(db, 'copySpeeds', { ...getSetting(db, 'copySpeeds'), [driveOf(plan.target)]: Math.round(doneBytes / seconds) });
    }
    onProgress({ type: 'copy', index: finished, total: finished, title: '', doneBytes, totalBytes, ...rate.sample(clock(), doneBytes, totalBytes) });
    if (okJobs.length) {
      const price = orders.priceOf(okJobs, priceSettings());
      result.price = price;
      result.orderId = orders.recordOrder(db, { customer: request.customer, phone: request.phone, note: request.note,
        items: okJobs.flatMap(itemsOfJob), bytes: doneBytes, price: price ? price.total : null,
        paid: paidOf(request.paid) }, now());
    }
    if (manifest.length) {
      const id = copies.saveCopy(db, { name: path.basename(plan.target), target: plan.target, files: manifest }, now());
      if (!result.cancelled) result.verify = await checkAndFix(id, ac, onProgress);
    }
    return result;
  }

  // ---- checking copies ----

  const copyRow = (id) => copies.listCopies(db).find((c) => c.id === id);
  const itemsOf = (c, files) => files.map((f) => ({ ...f, dest: copies.destOf(c.target, f.rel) }));

  function progressFor(onProgress, phase, total) {
    let last = 0;
    let doneBytes = 0;
    return {
      onFile: (index, n, f) => { last = 0; onProgress({ type: 'verify', phase, index, total: n, title: f.title, doneBytes, totalBytes: total }); },
      onBytes: (n) => {
        doneBytes += n;
        const t = Date.now();
        if (t - last >= 250) { last = t; onProgress({ type: 'verify', phase, index: -1, total: 0, title: '', doneBytes, totalBytes: total }); }
      },
    };
  }

  // Checks the copy and stores the verdict. Returns the raw problems too so a repair can start from them.
  async function checkCopy(c, { deep, signal, onProgress }) {
    const files = copies.copyFiles(db, c.id);
    const items = itemsOf(c, files);
    const r = await verifyFiles(items, { deep, signal, ...progressFor(onProgress, 'check', deep ? c.bytes : 0) });
    return { files, items, problems: r.problems, cancelled: r.cancelled };
  }

  // Copies each broken file again from its source. A damaged file is replaced only once its source is known to be readable.
  async function repairFiles(c, files, problems, { signal, onProgress }) {
    const drives = await getDrives();
    const rootOf = new Map(drives.filter((d) => d.online).map((d) => [d.serial, d.root]));
    const bad = new Set(problems.map((p) => p.dest));
    const failed = [];
    const fixed = [];
    const todo = files.filter((f) => bad.has(copies.destOf(c.target, f.rel)));
    const total = todo.reduce((n, f) => n + f.size, 0);
    const prog = progressFor(onProgress, 'repair', total);
    for (const [i, f] of todo.entries()) {
      if (signal.aborted) break;
      const dest = copies.destOf(c.target, f.rel);
      if (f.rel.split('/').includes('..') || !transfer.isInside(c.target, dest) || path.resolve(dest) === path.resolve(c.target)) { failed.push({ title: f.title, rel: f.rel, reason: 'bad_path' }); continue; }
      const root = rootOf.get(f.driveSerial);
      if (!root) { failed.push({ title: f.title, rel: f.rel, reason: 'offline' }); continue; }
      const src = path.join(root, ...f.srcRel.split('/'));
      if (!fs.existsSync(src)) { failed.push({ title: f.title, rel: f.rel, reason: 'source_missing' }); continue; }
      prog.onFile(i, todo.length, f);
      fs.rmSync(dest, { force: true });
      try {
        const r = await transfer.copyTree(src, dest, { signal, onBytes: prog.onBytes });
        if (r.cancelled) break;
        const got = r.files[0];
        db.prepare('UPDATE copy_files SET size = ?, sha = ? WHERE copy_id = ? AND rel = ?').run(got.size, got.sha, c.id, f.rel);
        fixed.push({ ...f, size: got.size, sha: got.sha });
      } catch (e) {
        failed.push({ title: f.title, rel: f.rel, reason: e.code || 'error' });
      }
    }
    return { fixed, failed };
  }

  // Deep check; whatever is wrong is copied again once, and only the repaired files are read again.
  async function checkAndFix(id, ac, onProgress) {
    const c = copyRow(id);
    const first = await checkCopy(c, { deep: true, signal: ac.signal, onProgress });
    if (first.cancelled) return { state: null, cancelled: true, checked: 0, problems: [], repaired: 0, failed: [] };
    let remaining = first.problems.map((p) => ({ ...p }));
    let repaired = 0;
    let failed = [];
    if (first.problems.length) {
      const fx = await repairFiles(c, first.files, first.problems, { signal: ac.signal, onProgress });
      failed = fx.failed;
      const again = await verifyFiles(itemsOf(c, fx.fixed), { deep: true, signal: ac.signal });
      repaired = fx.fixed.length - again.problems.length;
      const stillBad = new Set([...again.problems.map((p) => p.dest), ...first.files.filter((f) => failed.some((x) => x.rel === f.rel)).map((f) => copies.destOf(c.target, f.rel))]);
      remaining = first.problems.filter((p) => stillBad.has(p.dest)).map((p) => (again.problems.find((a) => a.dest === p.dest) || p));
    }
    const state = remaining.length ? 'problem' : 'ok';
    copies.markChecked(db, id, state, now());
    return { state, cancelled: ac.signal.aborted, checked: first.files.length, problems: copies.problemsByTitle(first.files, c.target, remaining), repaired, failed };
  }


  // the folders a tag lands on: the entry's own, or every film's of a collection
  const tagTargets = (e) => (e.kind === 'collection'
    ? e.members.flatMap((m) => search.find(m.key)?.locations ?? []).map((l) => l.id)
    : e.locations.map((l) => l.id));

  function changeTags(keys, text, apply, max) {
    const tag = tags.normalizeTag(text, max);
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

  function changeTag(key, text, apply, max) {
    const r = changeTags([key], text, apply, max);
    return !r.ok ? r : r.count ? { ok: true } : { ok: false, error: 'unknown' };
  }

  const manyTags = (keys, text, apply) => (keys.length ? changeTags(keys, text, apply) : { ok: false, error: 'nothing' });

  // the seasons of an entry that the archive holds, with the episode numbers read from file names (null: only the whole season can be chosen)
  async function seasonsOf(key) {
    const e = search.find(key);
    if (!e || e.kind === 'collection') return { ok: false, error: 'unknown' };
    const rootOf = new Map((await getDrives()).map((d) => [d.serial, d.root]));
    const seasons = new Map();
    for (const l of e.locations) {
      if (l.season == null || l.missing) continue;
      const n = Number(l.season);
      const src = rootOf.has(l.driveSerial) ? path.join(rootOf.get(l.driveSerial), l.relPath) : null;
      const have = seasons.get(n);
      if (have?.episodes && have.bytes !== null) continue; // one readable copy of the season is enough
      seasons.set(n, { season: n, episodes: src ? episodesIn(src) : null, bytes: src && fs.existsSync(src) ? transfer.treeSize(src) : null });
    }
    return { ok: true, seasons: [...seasons.values()].sort((a, b) => a.season - b.season) };
  }

  // what the shop typed as "paid now": digits only (Persian digits and separators allowed); nothing typed = the whole price
  const paidOf = (v) => {
    const d = normalizeFa(String(v ?? '')).replace(/[^\d]/g, '');
    return d === '' ? null : Number(d);
  };

  // ---- my collections: the owner's named lists --------------------------------
  // a collection key stands for every film inside it; unknown keys and unmatched folders are left out
  function playlistRefs(keys) {
    const refs = [];
    for (const k of Array.isArray(keys) ? keys : []) {
      const e = search.find(k);
      if (!e) continue;
      for (const f of e.kind === 'collection' ? e.members.map((m) => search.find(m.key)).filter(Boolean) : [e]) if (f.titleId != null) refs.push(refOfEntry(f));
    }
    return refs;
  }
  function playlistView(id) {
    const refs = playlists.refsOf(db, id);
    const byRef = new Map();
    for (const e of search.query({}).entries) if (e.kind !== 'collection' && e.titleId != null) byRef.set(refOfEntry(e), e);
    const items = refs.map((r) => byRef.get(r)).filter(Boolean);
    return { items: items.map(lightOf), missing: refs.length - items.length };
  }

  // ---- films added by hand: the owner types the facts and picks the picture and the file ----
  const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp']);
  const manualText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const manualGenres = (g) => [...new Set((Array.isArray(g) ? g : String(g ?? '').split(/[,،]/)).map((x) => manualText(x, 40)).filter(Boolean))].slice(0, 12).join(', ') || null;
  // the file the owner picked: a video (or a folder) on a plugged-in drive → where it is stored; otherwise the reason
  async function manualPlace(filePath) {
    let st;
    try { st = fs.statSync(filePath); } catch { return { error: 'not_found' }; }
    if (st.isFile() && !VIDEO.has(path.extname(filePath).slice(1).toLowerCase())) return { error: 'not_media' };
    if (!st.isFile() && !st.isDirectory()) return { error: 'not_found' };
    const hit = toDriveRel((await getDrives()).filter((d) => d.online), filePath);
    if (!hit || !hit.relPath) return { error: 'no_drive' };
    return { serial: hit.serial, relPath: hit.relPath, name: path.basename(filePath) };
  }
  // the picture is copied into the archive's own poster folder under a new name, so a replaced picture never shows a stale cache
  function manualPoster(titleId, picked) {
    const ext = path.extname(String(picked || '')).slice(1).toLowerCase();
    if (!picked || !IMAGE.has(ext)) return null;
    try {
      fs.mkdirSync(postersDir, { recursive: true });
      const file = `manual-${titleId}-${Date.now()}.${ext}`;
      fs.copyFileSync(picked, path.join(postersDir, file));
      return file;
    } catch { return null; }
  }
  const manualFields = (f) => ({
    title: manualText(f.title, 200), year: manualText(f.year, 9) || null, type: f.kind === 'series' ? 'series' : 'movie',
    plot: manualText(f.plot, 4000) || null, genres: manualGenres(f.genres), director: manualText(f.director, 200) || null,
    actors: manualText(f.actors, 400) || null, runtime: manualText(f.runtime, 30) || null, country: manualText(f.country, 120) || null,
  });

  // ---- phone catalog: a read-only page on the shop network, customers send back the films they want ----
  const catalogServer = createCatalogServer({
    viaTunnel: () => tunnel.status().state === 'on',
    films: (lang) => {
      const list = search.query({}).entries.filter((e) => e.kind !== 'collection');
      const rel = relatedMap(list);
      return list.map((e) => {
        const row = catalogRow(e, lang);
        const rl = (rel.get(e.key) || []).slice(0, 12).map((x) => x.key); // keys only: the page filters its own list
        return rl.length ? { ...row, rl } : row;
      });
    },
    posterFile: (k) => {
      const f = search.find(k)?.posterFile;
      if (!f) return null;
      try { return fs.readFileSync(path.join(postersDir, path.basename(f))); } catch { return null; }
    },
    font: () => { try { return fs.readFileSync(path.join(__dirname, 'renderer', 'fonts', 'Vazirmatn-Variable.woff2')); } catch { return null; } },
    known: (k) => { const e = search.find(k); return e && e.kind !== 'collection' ? { key: e.key, title: e.title, year: e.year } : null; },
    submit: (w) => saveWish(db, w, now(), WISH_LIMIT),
    info: () => ({ prices: { movie: getSetting(db, 'priceMovie'), season: getSetting(db, 'priceSeason'), episode: getSetting(db, 'priceEpisode') }, shop: getSetting(db, 'shopName') }),
    // only a film that has season folders answers; the page then offers the seasons and episodes to pick from
    seasons: async (k) => { const r = await seasonsOf(k); return r.ok && r.seasons.length ? r.seasons : null; },
    // a film that is already in the archive is not demand: only a missing one is counted in the request list
    ask: (name, who) => {
      const found = inArchiveNamed(name);
      if (found.length) return { ok: true, inArchive: found.map((f) => f.title) };
      return orders.addRequest(db, name, now(), who) ? { ok: true, inArchive: [] } : { ok: false };
    },
    clock,
  });
  let catalogUrl = null;
  let catalogPortNow = 0;

  // already here: the same name as a title or other name, or inside a folder name
  function inArchiveNamed(name) {
    const key = orders.nameKey(name);
    return search.query({}).entries.filter((e) => e.kind !== 'collection' && [e.title, ...e.aliases].some((n) => orders.nameKey(n) === key)
      || (key.length >= 4 && e.locations.some((l) => orders.nameKey(l.folderName).includes(key)))).map((e) => ({ key: e.key, title: e.title }));
  }

  // the internet part of the catalog info: the tunnel's state and, when it is on, its address with a QR
  async function internetInfo() {
    const s = tunnel.status();
    return { state: s.state, url: s.url, qr: s.url ? await qr(s.url) : null, error: s.error };
  }
  async function catalogInfo() {
    if (!catalogServer.running || !catalogUrl) return { running: false };
    return { running: true, url: catalogUrl, qr: await qr(catalogUrl), internet: await internetInfo() };
  }

  return {
    async getSettings() {
      return Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(db, k)]));
    },
    async setSettings(partial) {
      for (const k of SETTING_KEYS) {
        if (!(k in partial)) continue;
        let v = partial[k];
        if (PRICE_KEYS.includes(k)) { v = Number(v); v = Number.isFinite(v) && v > 0 ? v : 0; }
        if (k === 'shopName') v = String(v ?? '').trim().slice(0, 80);
        if (k === 'phoneCatalog' || k === 'phoneInternet') v = !!v;
        if (k === 'catalogPort') { v = Number(v); v = Number.isInteger(v) && v >= 0 && v <= 65535 ? v : 8787; }
        setSetting(db, k, v);
      }
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
        db.exec('DELETE FROM aliases WHERE location_id NOT IN (SELECT id FROM locations)');
        db.exec('DELETE FROM quality_marks WHERE location_id NOT IN (SELECT id FROM locations)');
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
    // films of the archive that resemble this one, with why (genre, director, actors, country, tags)
    // the same series or franchise (by name, or the same owner folder), oldest first; shown before the similar list
    async getRelated(key) {
      const base = search.find(key);
      if (!base) return { ok: false, error: 'unknown' };
      return { ok: true, items: relatedTo(base, search.query({}).entries).map(lightOf) };
    },
    async getSimilar(key, limit = 12) {
      const base = search.find(key);
      if (!base) return { ok: false, error: 'unknown' };
      const { entries } = search.query({});
      const related = new Set(relatedTo(base, entries).map((x) => x.key)); // already in its own list
      return { ok: true, items: similarTo(base, entries.filter((x) => !related.has(x.key)), { limit }).map((r) => ({ ...lightOf(r.entry), score: r.score, reasons: r.reasons })) };
    },
    // Anime that MyAnimeList users recommend after this one (Jikan). Those already in the archive come back as card entries,
    // the others with a poster saved next to the archive posters. Answers are stored, so a title is asked for once.
    async getRecommendations(key, limit = 12) {
      const e = search.find(key);
      if (!e || e.titleId == null) return { ok: false, error: 'unknown' };
      let malId = db.prepare('SELECT mal_id FROM titles WHERE id = ?').get(e.titleId)?.mal_id ?? null;
      if (!malId && !(e.type === 'anime' || e.genreList.includes('Animation'))) return { ok: false, error: 'not_anime' };
      try {
        if (!malId) {
          // an OMDb animation: use the MyAnimeList entry only when its name is exactly this title's name
          malId = getCache(db, `mal-of:${e.titleId}`) ?? null;
          if (!malId) {
            const hit = await jikan.searchAnime(e.title, e.year ? String(e.year).slice(0, 4) : null);
            if (!hit || nameKey(hit.title) !== nameKey(e.title)) return { ok: false, error: 'not_found' };
            malId = hit.malId;
            putCache(db, `mal-of:${e.titleId}`, malId);
          }
        }
        const recs = await cached(db, `mal-rec:${malId}`, () => jikan.recommendations(malId, 25));
        const keyOfMal = new Map(db.prepare('SELECT id, mal_id FROM titles WHERE mal_id IS NOT NULL').all().map((r) => [r.mal_id, `t:${r.id}`]));
        const byName = new Map(search.query({}).entries.filter((x) => x.status === 'matched' && x.kind !== 'collection').map((x) => [nameKey(x.title), x]));
        const inArchive = [];
        const outside = [];
        for (const r of recs) {
          const mine = search.find(keyOfMal.get(r.malId)) ?? byName.get(nameKey(r.title));
          if (mine) { if (mine.key !== e.key && inArchive.length < limit) inArchive.push({ ...lightOf(mine), votes: r.votes }); } else if (outside.length < limit) outside.push(r);
        }
        const withPoster = await Promise.all(outside.map(async (r) => {
          const name = `mal${r.malId}`;
          const posterFile = fs.existsSync(path.join(postersDir, `${name}.jpg`)) ? `${name}.jpg` : await savePoster(r.posterUrl, postersDir, name, fetch);
          return { malId: r.malId, title: r.title, votes: r.votes, posterFile };
        }));
        return { ok: true, inArchive, outside: withPoster };
      } catch (err) {
        if (err instanceof ProviderError) return { ok: false, error: err.kind };
        throw err;
      }
    },
    async openMal(malId) {
      if (!Number.isInteger(malId) || malId < 1) return { ok: false };
      await openExternal(`https://myanimelist.net/anime/${malId}`);
      return { ok: true };
    },
    // manual tags belong to the folders of an entry, so they survive rescans and online fixes
    async addTag(key, text) {
      return changeTag(key, text, tags.addTag);
    },
    async removeTag(key, text) {
      return changeTag(key, text, tags.removeTag);
    },
    // seasons whose folder lacks episodes that have aired (folders of plugged-in drives only; names must carry episode numbers)
    async getSeriesGaps() {
      const r = seriesGaps(db, { today: new Date(now()).toISOString().slice(0, 10) });
      return { ...r, entries: r.entries.map((e) => ({ ...e, key: `t:${e.titleId}` })) };
    },
    // films and series that live on one drive only, per drive: what would be lost with it
    async getCatalog() {
      return catalogByGenre(search.query({}).entries);
    },
    // copies of the same film or season in several folders, with sizes read from the plugged-in drives (report only: nothing is deleted)
    async getDuplicates() {
      const rootOf = new Map((await getDrives()).map((d) => [d.serial, d.root]));
      return duplicates(search.query({}).entries, (l) => {
        const root = l.online ? rootOf.get(l.driveSerial) : null;
        if (!root) return null;
        const p = path.join(root, l.relPath);
        try { return fs.existsSync(p) ? transfer.treeSize(p) : null; } catch { return null; }
      });
    },
    async getSingleDrive() {
      return singleDrive(search.query({}).entries);
    },
    // what the owner made by hand (tags, other names, lists, calendar, copies), to a file and back; the archive itself is rescanned
    async exportBackup(file) {
      try {
        fs.writeFileSync(file, JSON.stringify(exportData(db, { now: now(), postersDir }), null, 1));
        return { ok: true };
      } catch {
        return { ok: false, error: 'unwritable' };
      }
    },
    async importBackup(file) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, error: 'unreadable' }; }
      try {
        const r = importData(db, JSON.parse(text), { postersDir });
        search.invalidate();
        return { ok: true, ...r };
      } catch {
        return { ok: false, error: 'not_a_backup' };
      }
    },
    // the size and price of a list before a destination exists: the same copy choice the plan makes, without a destination
    async estimateSize(keys = [], destDir = '', picks = null) {
      const drives = await getDrives();
      search.invalidate();
      const rootOf = new Map(drives.map((d) => [d.serial, d.root]));
      const jobs = [];
      for (const key of keys) {
        const e = search.find(key);
        if (!e) continue;
        if (e.kind === 'collection') {
          const c = e.collection;
          const src = c.online && !c.missing && rootOf.has(c.driveSerial) ? path.join(rootOf.get(c.driveSerial), c.relPath) : null;
          if (src && fs.existsSync(src)) jobs.push({ bytes: transfer.treeSize(src), season: null });
          continue;
        }
        for (const { l, only } of chosenLocations(e, picks, undefined, rootOf).chosen) {
          const src = path.join(rootOf.get(l.driveSerial), l.relPath);
          if (fs.existsSync(src)) jobs.push({ bytes: transfer.treeSize(src, only ? episodeFilter(only) : undefined), season: l.season ?? null, ...(only ? { episodes: only.length } : {}) });
        }
      }
      const bytes = jobs.reduce((n, j) => n + j.bytes, 0);
      if (!jobs.length) return { bytes, count: 0, price: null };
      const speed = destDir ? getSetting(db, 'copySpeeds')[driveOf(destDir)] : 0;
      return { bytes, count: jobs.length, price: orders.priceOf(jobs, priceSettings()), etaSec: speed > 0 ? Math.max(1, Math.round(bytes / speed)) : null };
    },
    // free bytes of the folder's disk, null when the folder is not there
    async getFreeSpace(dir) {
      if (!dir || !fs.existsSync(dir)) return null;
      const n = freeSpace(dir);
      return Number.isFinite(n) ? n : null;
    },
    // ---- customers: orders, delivery history, requests, flash drives ----
    async getOrders(opts = {}) {
      return orders.listOrders(db, opts);
    },
    async getCustomers() {
      return orders.customers(db);
    },
    // money: what is still owed, payments that come later, and income / demand over the last N days (no N: everything)
    async getDebtors() { return orders.debtors(db); },
    async payOrder(id, amount) { return orders.payOrder(db, id, amount); },
    async setOrderPaid(id, amount) { return orders.setPaid(db, id, amount); },
    async getSales({ days = 0 } = {}) {
      const n = Number(days);
      return orders.salesReport(db, { since: n > 0 ? now() - n * 86400000 : 0 });
    },
    // which of these entries this customer already received: { [key]: { created, orderId } }
    async getDelivered({ customer, keys = [] } = {}) {
      const out = {};
      for (const key of keys) {
        const e = search.find(key);
        if (!e) continue;
        const members = e.kind === 'collection' ? e.members.map((m) => search.find(m.key)).filter(Boolean) : [e];
        const seen = [...orders.deliveredTo(db, customer, members.map(refOfEntry)).values()];
        if (seen.length) out[key] = seen.reduce((a, b) => (b.created > a.created ? b : a));
      }
      return out;
    },
    // removes the record only; nothing on any disk is touched
    async removeOrder(id) {
      orders.removeOrder(db, id);
      return { ok: true };
    },
    async getRemovable() {
      return listRemovable();
    },
    // only a drive that is listed as removable right now can be ejected
    async ejectDrive(root) {
      const hit = (await listRemovable()).find((d) => d.root.toLowerCase() === String(root).toLowerCase());
      return hit ? eject(hit.root) : { ok: false, error: 'not_removable' };
    },
    async addRequest(name, who = {}) {
      if (String(name ?? '').trim().length > 100) return { ok: false, error: 'too_long' };
      const r = orders.addRequest(db, name, now(), who);
      if (!r) return { ok: false, error: 'empty' };
      return { ok: true, ...r, inArchive: inArchiveNamed(r.name) };
    },
    async getRequests() {
      return orders.listRequests(db);
    },
    async removeRequest(id) {
      orders.removeRequest(db, id);
      return { ok: true };
    },
    async removeAsker(id) {
      orders.removeAsker(db, id);
      return { ok: true };
    },
    // requested films that are in the archive now, with the people who asked and are still to be told
    async getArrived() {
      const out = [];
      for (const r of orders.listRequests(db)) {
        const matches = inArchiveNamed(r.name);
        if (matches.length) out.push({ ...r, matches });
      }
      return out;
    },
    // the owner ticks a guessed match: it becomes verified and is pinned, so no later rescan or queue run touches it
    async confirmGuess(key) {
      const e = search.find(key);
      if (!e || e.kind === 'collection') return { ok: false, error: 'unknown' };
      const ids = tagTargets(e);
      db.exec('BEGIN');
      try {
        for (const id of ids) db.prepare('UPDATE locations SET guessed = 0, pinned = 1 WHERE id = ?').run(id);
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      search.invalidate();
      return { ok: true };
    },
    // A film the owner types in: facts + picture + the file. It is a verified entry (pinned), so no scan, queue or fix run touches it;
    // it changes only through updateManualFilm or an Online Info Fix link the owner gives.
    async addManualFilm(f) {
      const v = manualFields(f ?? {});
      if (!v.title) return { ok: false, error: 'no_title' };
      const place = await manualPlace(String(f.filePath ?? ''));
      if (place.error) return { ok: false, error: place.error };
      if (db.prepare('SELECT 1 FROM locations WHERE drive_serial = ? AND rel_path = ?').get(place.serial, place.relPath)) return { ok: false, error: 'already' };
      let titleId;
      db.exec('BEGIN');
      try {
        titleId = Number(db.prepare(`INSERT INTO titles(source, title, year, type, plot, genres, director, actors, runtime, country)
          VALUES('manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(v.title, v.year, v.type, v.plot, v.genres, v.director, v.actors, v.runtime, v.country).lastInsertRowid);
        db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, parsed_year, title_id, status, pinned)
          VALUES(?, ?, ?, ?, ?, ?, 'matched', 1)`).run(place.serial, place.relPath, place.name, v.title, v.year, titleId);
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      const poster = manualPoster(titleId, f.posterPath);
      if (poster) db.prepare('UPDATE titles SET poster_file = ? WHERE id = ?').run(poster, titleId);
      search.invalidate();
      return { ok: true, key: `t:${titleId}` };
    },
    // only what the owner typed: the fields sent replace the old ones, the others stay
    async updateManualFilm(key, f) {
      const e = search.find(key);
      if (!e) return { ok: false, error: 'unknown' };
      if (e.titleId == null) return { ok: false, error: 'not_manual' };
      const row = db.prepare('SELECT source, poster_file FROM titles WHERE id = ?').get(e.titleId);
      if (row?.source !== 'manual') return { ok: false, error: 'not_manual' };
      const v = manualFields({ ...e, kind: e.kind, ...f, genres: f.genres ?? e.genres });
      if (!v.title) return { ok: false, error: 'no_title' };
      db.prepare('UPDATE titles SET title = ?, year = ?, type = ?, plot = ?, genres = ?, director = ?, actors = ?, runtime = ?, country = ? WHERE id = ?')
        .run(v.title, v.year, v.type, v.plot, v.genres, v.director, v.actors, v.runtime, v.country, e.titleId);
      db.prepare('UPDATE locations SET parsed_title = ?, parsed_year = ? WHERE title_id = ?').run(v.title, v.year, e.titleId);
      if (f.posterPath) {
        const poster = manualPoster(e.titleId, f.posterPath);
        if (poster) {
          db.prepare('UPDATE titles SET poster_file = ? WHERE id = ?').run(poster, e.titleId);
          if (row.poster_file?.startsWith('manual-')) fs.rmSync(path.join(postersDir, path.basename(row.poster_file)), { force: true });
        }
      }
      search.invalidate();
      return { ok: true };
    },
    // the file moved: the same manual film also lives at the new path (the old location stays and shows as missing/offline until removed)
    async addManualPath(key, filePath) {
      const e = search.find(key);
      if (!e) return { ok: false, error: 'unknown' };
      if (e.titleId == null || db.prepare('SELECT source FROM titles WHERE id = ?').get(e.titleId)?.source !== 'manual') return { ok: false, error: 'not_manual' };
      const place = await manualPlace(String(filePath ?? ''));
      if (place.error) return { ok: false, error: place.error };
      if (!db.prepare('SELECT 1 FROM locations WHERE drive_serial = ? AND rel_path = ?').get(place.serial, place.relPath)) {
        db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, parsed_year, title_id, status, pinned)
          VALUES(?, ?, ?, ?, ?, ?, 'matched', 1)`).run(place.serial, place.relPath, place.name, e.title, e.year, e.titleId);
        search.invalidate();
      }
      return { ok: true };
    },
    async getPlaylists() { return playlists.list(db); },
    async getPlaylist(id) {
      const p = db.prepare('SELECT id, name, note FROM playlists WHERE id = ?').get(id);
      return p ? { ok: true, ...p, ...playlistView(id) } : { ok: false, error: 'unknown' };
    },
    async createPlaylist(f) { return playlists.create(db, f ?? {}, now()); },
    async updatePlaylist(id, f) { return playlists.update(db, id, f ?? {}); },
    async deletePlaylist(id) { return playlists.remove(db, id) ? { ok: true } : { ok: false, error: 'unknown' }; },
    async addToPlaylist(id, keys) {
      if (!playlists.exists(db, id)) return { ok: false, error: 'unknown' };
      return { ok: true, added: playlists.addRefs(db, id, playlistRefs(keys)) };
    },
    async setPlaylistItems(id, keys) {
      if (!playlists.exists(db, id)) return { ok: false, error: 'unknown' };
      playlists.setRefs(db, id, playlistRefs(keys));
      return { ok: true };
    },
    async removeFromPlaylist(id, key) {
      if (!playlists.exists(db, id)) return { ok: false, error: 'unknown' };
      const e = search.find(key);
      if (e) for (const r of playlistRefs([key])) playlists.removeRef(db, id, r);
      return { ok: true };
    },
    // a collection named after the film, holding it and the other films of its series, oldest first
    async createPlaylistFromRelated(key) {
      const e = search.find(key);
      if (!e || e.kind === 'collection' || e.titleId == null) return { ok: false, error: 'unknown' };
      const same = [e, ...relatedTo(e, search.query({}).entries)].sort((a, b) => (/\d{4}/.exec(a.year)?.[0] ?? 9999) - (/\d{4}/.exec(b.year)?.[0] ?? 9999));
      const made = playlists.create(db, { name: franchiseKey(e.title).replace(/(^|\s)\S/g, (c) => c.toUpperCase()) || e.title, note: '' }, now());
      if (!made.ok) return made;
      playlists.setRefs(db, made.id, playlistRefs(same.map((x) => x.key)));
      return made;
    },
    // "Remove" from the archive view: only the app forgets to show it, the folder on the disk is never touched and a rescan keeps it hidden
    async hideEntry(key) {
      const e = search.find(key);
      if (!e) return { ok: false, error: 'unknown' };
      for (const id of tagTargets(e)) db.prepare('UPDATE locations SET hidden = 1 WHERE id = ?').run(id);
      search.invalidate();
      return { ok: true };
    },
    async getHidden() {
      return db.prepare(`SELECT l.id, l.rel_path AS relPath, COALESCE(d.label, l.drive_serial) AS driveLabel, COALESCE(t.title, l.parsed_title, l.folder_name) AS title
        FROM locations l LEFT JOIN drives d ON d.serial = l.drive_serial LEFT JOIN titles t ON t.id = l.title_id
        WHERE l.hidden = 1 ORDER BY title COLLATE NOCASE`).all().map((r) => ({ ...r }));
    },
    async unhide(id) {
      const r = db.prepare('UPDATE locations SET hidden = 0 WHERE id = ? AND hidden = 1').run(id);
      if (!r.changes) return { ok: false, error: 'unknown' };
      search.invalidate();
      return { ok: true };
    },
    // dub / sub set by hand on every folder of the entry (a collection: of every film in it). value true/false, or null = automatic again
    async setQualityMark(key, flag, value) {
      if (flag !== 'dub' && flag !== 'sub') return { ok: false, error: 'bad_flag' };
      const e = search.find(key);
      if (!e) return { ok: false, error: 'unknown' };
      const ids = tagTargets(e);
      if (!ids.length) return { ok: false, error: 'unknown' };
      const del = db.prepare('DELETE FROM quality_marks WHERE location_id = ? AND flag = ?');
      const put = db.prepare('INSERT OR REPLACE INTO quality_marks(location_id, flag, value) VALUES(?, ?, ?)');
      for (const id of ids) {
        if (value === null || value === undefined) del.run(id, flag); else put.run(id, flag, value ? 1 : 0);
      }
      search.invalidate();
      return { ok: true };
    },
    // other names (Persian ones, mostly) the film can be found by; they stay with the folder like tags do
    // the price calculator in the invoice settings: what would this many movies, seasons and single episodes cost
    // `prices` (typed in the form, not saved yet) win over the saved ones; trying them saves nothing
    async calcPrice(counts = {}, prices = {}) {
      const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
      const price = (k) => (prices[k] == null || prices[k] === '' ? getSetting(db, k) : (Number(prices[k]) > 0 ? Number(prices[k]) : 0));
      const r = orders.priceCount({ movies: n(counts.movies), seasons: n(counts.seasons), episodes: n(counts.episodes) },
        { priceMovie: price('priceMovie'), priceSeason: price('priceSeason'), priceEpisode: price('priceEpisode') });
      return r ? { ok: true, ...r } : { ok: true, total: null };
    },
    // the one Persian name of a film: replaces whatever was there; empty text removes it
    async setPersianName(key, text) {
      const name = tags.normalizeTag(text, tags.ALIAS_MAX);
      if (name === 'too_long') return { ok: false, error: 'too_long' };
      const e = search.find(key);
      if (!e || e.kind === 'collection') return { ok: false, error: 'unknown' };
      const ids = tagTargets(e);
      db.exec('BEGIN');
      try {
        for (const id of ids) db.prepare('DELETE FROM aliases WHERE location_id = ?').run(id);
        if (name) tags.addAlias(db, ids, name);
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      search.invalidate();
      return { ok: true };
    },
    planTransfer,
    startTransfer,
    // the owner's named copy lists (what is in each and where it goes); the renderer keeps them in memory and saves on change
    async getCopyLists() {
      return getSetting(db, 'copyLists') ?? [];
    },
    async saveCopyLists(lists) {
      const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
      const clean = (Array.isArray(lists) ? lists : []).slice(0, 30).flatMap((l) => {
        const id = str(l?.id, 40);
        const name = str(l?.name, 100);
        if (!id || name === null) return [];
        const items = (Array.isArray(l.items) ? l.items : []).slice(0, 5000)
          .filter((x) => Array.isArray(x) && str(x[0], 300) && typeof x[1] === 'string')
          .map((x) => [x[0], x[1].slice(0, 200)]);
        const phoneKeys = (Array.isArray(l.phoneKeys) ? l.phoneKeys : []).slice(0, 5000).filter((k) => str(k, 300));
        // the seasons / episodes the customer chose, per film (see cleanPick)
        const picks = {};
        for (const [k, v] of Object.entries(l.picks && typeof l.picks === 'object' ? l.picks : {}).slice(0, 5000)) {
          const p = cleanPick(v);
          if (str(k, 300) && (p.seasons.length || Object.keys(p.episodes).length)) picks[k] = p;
        }
        return [{ id, name, dest: str(l.dest, 500) ?? '', items, customer: str(l.customer, 80) ?? '', phoneKeys, picks }];
      });
      setSetting(db, 'copyLists', clean);
      return { ok: true };
    },
    async getCopies() {
      return copies.listCopies(db);
    },
    // read-only check of a finished copy; `deep` re-reads every file and compares its SHA-256
    verifyCopy(id, { deep = true } = {}, onProgress = () => {}) {
      return exclusive(async (ac) => {
        const c = copyRow(id);
        if (!c) return { ok: false, error: 'unknown' };
        const r = await checkCopy(c, { deep, signal: ac.signal, onProgress });
        if (r.cancelled) return { ok: true, cancelled: true };
        const state = r.problems.length ? 'problem' : 'ok';
        copies.markChecked(db, id, state, now());
        return { ok: true, cancelled: false, state, checked: r.files.length, problems: copies.problemsByTitle(r.files, c.target, r.problems) };
      });
    },
    // check deeply, copy broken or missing files again from their sources, check those again
    repairCopy(id, onProgress = () => {}) {
      return exclusive(async (ac) => {
        if (!copyRow(id)) return { ok: false, error: 'unknown' };
        const v = await checkAndFix(id, ac, onProgress);
        return { ok: true, repaired: v.repaired, failed: v.failed, cancelled: v.cancelled, verify: v };
      });
    },
    async removeCopy(id) {
      copies.removeCopy(db, id);
      return { ok: true };
    },
    // while a copy runs: films added to / taken off its list. Not yet copied ones are dropped, the one being copied is stopped
    // and its files removed; a film already on the drive stays there (`kept`).
    async updateTransfer({ add = [], remove = [], picks = null } = {}) {
      if (!liveTransfer) return { ok: false, error: 'idle' };
      const live = liveTransfer;
      const { removed, kept } = live.remove(remove);
      const added = add.length ? await live.track(live.add(add, picks)) : 0;
      return { ok: true, added, removed, kept };
    },
    // see seasonsOf
    async getSeasons(key) { return seasonsOf(key); },
    // the same customer? (name compared the way the order history does)
    async customerKey(name) { return orders.customerKey(String(name ?? '')); },
    // what a customer's new selection changes in the list already made for them
    async diffWish(arg) { return diffWish(arg ?? {}); },
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
    async getVersion() {
      return version;
    },
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
    downloadUpdate: (onProgress = () => {}) => updater.download(onProgress),
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
    async getCatalogInfo() {
      return catalogInfo();
    },
    async startCatalog() {
      try {
        const { port } = await catalogServer.start(getSetting(db, 'catalogPort'));
        catalogUrl = `http://${lanAddress()}:${port}`;
        catalogPortNow = port;
      } catch (e) {
        return { ok: false, error: e.code === 'EADDRINUSE' ? 'port_busy' : 'start_failed' };
      }
      setSetting(db, 'phoneCatalog', true);
      return { ok: true, ...(await catalogInfo()) };
    },
    // reachable from a customer's own mobile data: a public https address (Cloudflare quick tunnel) that forwards to the catalog
    async startInternet() {
      if (!catalogServer.running) return { ok: false, error: 'catalog_off' };
      const r = await tunnel.start(catalogPortNow);
      setSetting(db, 'phoneInternet', !!r.ok);
      return r.ok ? { ok: true, internet: await internetInfo() } : { ok: false, error: r.error, internet: await internetInfo() };
    },
    async stopInternet() {
      await tunnel.stop();
      setSetting(db, 'phoneInternet', false);
      return { ok: true, internet: await internetInfo() };
    },
    async stopCatalog() {
      await tunnel.stop();
      setSetting(db, 'phoneInternet', false);
      await catalogServer.stop();
      catalogUrl = null;
      setSetting(db, 'phoneCatalog', false);
      return { ok: true };
    },
    // at launch: bring the catalog back when it was left on
    async initCatalog() {
      if (getSetting(db, 'phoneCatalog')) {
        await this.startCatalog();
        if (getSetting(db, 'phoneInternet')) this.startInternet().catch(() => {}); // takes a few seconds: the window does not wait for it
      }
      return catalogInfo();
    },
    async getWishes() {
      return db.prepare('SELECT id, name, phone, note, created, updated, items FROM wishes ORDER BY COALESCE(updated, created) DESC, id DESC').all()
        .map((w) => ({ ...w, items: JSON.parse(w.items) }));
    },
    async removeWish(id) {
      db.prepare('DELETE FROM wishes WHERE id = ?').run(id);
      return { ok: true };
    },
    posterPath(file) {
      return path.join(postersDir, path.basename(file));
    },
  };
}

module.exports = { createApi };
