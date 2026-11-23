'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/core/db.js');
const { createApi } = require('../src/api.js');

const OMDB_BODY = {
  Response: 'True', imdbID: 'tt1877830', Title: 'The Batman', Year: '2022', Type: 'movie', Plot: 'p', Genre: 'Action',
  imdbRating: '7.8', Runtime: '176 min', Actors: 'Robert Pattinson', Poster: 'https://img.example/p.jpg',
};

function setup({ jikan, updater, key = 'K', openPath, openExternal, mymemory, freeSpace, translatePause, now, clock, version, listRemovable, eject, qr, lanAddress } = {}) {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-'));
  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('omdbapi.com')) {
      const t = new URL(url).searchParams.get('t');
      // any title other than "batman" gets its own imdb id, so tests can have two distinct titles
      const body = t && t !== 'batman' ? { ...OMDB_BODY, imdbID: `tt${1000000 + [...t].reduce((a, c) => a + c.charCodeAt(0), 0)}`, Title: t, Poster: 'N/A' } : OMDB_BODY;
      return { ok: true, status: 200, json: async () => body };
    }
    if (String(url).includes('jikan.moe')) {
      const data = jikan ? jikan(String(url)) : [];
      if (data === 'offline') throw new TypeError('offline');
      return { ok: true, status: 200, json: async () => ({ data }) };
    }
    if (String(url).includes('mymemory')) return { ok: true, status: 200, json: async () => (mymemory ? mymemory(url) : { responseStatus: 200, responseData: { translatedText: 'سلام' } }) };
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9, 9]).buffer };
  };
  const db = openDb();
  const state = { online: true };
  const api = createApi({
    db, userDataDir: userData, fetch, openPath, openExternal, freeSpace, translatePause, now, clock, version, updater, listRemovable, eject, qr, lanAddress,
    listDrives: async () => (state.online ? [{ serial: 'S1', label: 'Test', root: media + path.sep }] : []),
  });
  return { api, db, media, userData, fetchCalls, key, state };
}
const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().join('|');

test('addRoot stores the path relative to its drive; a path outside every drive is refused', async () => {
  const { api, media } = setup();
  fs.mkdirSync(path.join(media, 'Movies'));
  assert.deepEqual(await api.addRoot(path.join(media, 'Movies')), { ok: true });
  const roots = await api.getRoots();
  assert.deepEqual([roots[0].relPath, roots[0].driveLabel, roots[0].online], ['Movies', 'Test', true]);
  assert.deepEqual(await api.addRoot('/somewhere/else'), { ok: false, error: 'no_drive' });
});

test('scan lists folders as entries, including empty ones, and never writes into the media folder', async () => {
  const { api, media } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'batman 2022'), { recursive: true });
  fs.mkdirSync(path.join(media, 'Movies', 'Empty'));
  fs.writeFileSync(path.join(media, 'Movies', 'batman 2022', 'movie.mkv'), 'x');
  await api.addRoot(path.join(media, 'Movies'));
  const before = snapshot(media);
  assert.deepEqual(await api.scan(), { scanned: 1, added: 2 });
  assert.equal(snapshot(media), before);
  const entries = (await api.getEntries()).entries;
  assert.equal(entries.length, 2);
  assert.equal(entries.find((e) => e.title === 'Empty').locations[0].isEmpty, true);
});

test('startQueue without an OMDb key stops with bad_key and sends no request', async () => {
  const { api, media, fetchCalls } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'batman 2022'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  const r = await api.startQueue(() => {});
  assert.deepEqual(r, { processed: 0, remaining: 1, stoppedBy: 'bad_key', episodes: 0 });
  assert.equal(fetchCalls.length, 0);
});

test('startQueue with a key matches the folder and saves the poster under userData', async () => {
  const { api, media, userData } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'batman 2022'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  await api.setSettings({ omdbKey: 'K' });
  const r = await api.startQueue(() => {});
  assert.deepEqual(r, { processed: 1, remaining: 0, stoppedBy: null, episodes: 0 });
  const [e] = (await api.getEntries()).entries;
  assert.deepEqual([e.title, e.status, e.posterFile], ['The Batman', 'matched', 'tt1877830.jpg']);
  assert.ok(fs.existsSync(path.join(userData, 'posters', 'tt1877830.jpg')));
  assert.equal(api.posterPath('../../evil.jpg'), path.join(userData, 'posters', 'evil.jpg'));
});

test('applyFix through the api re-points an entry using a pasted link', async () => {
  const { api, media } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'whatever'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  await api.setSettings({ omdbKey: 'K' });
  const [before] = (await api.getEntries()).entries;
  const r = await api.applyFix({ locationId: before.locationId }, 'https://www.imdb.com/title/tt1877830/');
  assert.equal(r.ok, true);
  assert.equal((await api.getEntries()).entries[0].title, 'The Batman');
});

test('applyFix without a key reports bad_key and sends no request', async () => {
  const { api, media, fetchCalls } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'x'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  const [e] = (await api.getEntries()).entries;
  assert.deepEqual(await api.applyFix({ locationId: e.locationId }, 'tt1877830'), { ok: false, error: 'bad_key' });
  assert.equal(fetchCalls.length, 0);
});

test('removeRoot drops the root, its folders and titles left without a folder', async () => {
  const { api, db, media } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'batman 2022'), { recursive: true });
  fs.mkdirSync(path.join(media, 'Anime', 'naruto'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.addRoot(path.join(media, 'Anime'));
  await api.scan();
  await api.setSettings({ omdbKey: 'K' });
  await api.startQueue(() => {});
  assert.equal((await api.getEntries()).entries.length, 2);
  const movies = (await api.getRoots()).find((r) => r.relPath === 'Movies');
  const batman = db.prepare("SELECT title_id FROM locations WHERE rel_path = 'Movies/batman 2022'").get().title_id;
  db.prepare("INSERT INTO episodes(title_id, season, number) VALUES(?, 1, 1)").run(batman);
  db.prepare('INSERT INTO cache(key, value) VALUES(?, ?)').run(`season-none:${batman}:2`, '1');
  await api.removeRoot(movies.id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM episodes').get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM cache WHERE key LIKE 'season-none:%'").get().c, 0);
  const left = (await api.getEntries()).entries;
  assert.deepEqual(left.map((e) => e.locations[0].relPath), ['Anime/naruto']);
  assert.equal((await api.getRoots()).length, 1);
});

test('settings round trip and the search index follows them', async () => {
  const { api } = setup();
  await api.setSettings({ patterns: ['{title}'], language: 'en' });
  const s = await api.getSettings();
  assert.deepEqual([s.patterns, s.language], [['{title}'], 'en']);
});

test('preload exposes exactly the methods the api has (plus the two electron-only helpers)', () => {
  const { api } = setup();
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const listed = [...src.match(/const METHODS = \[([\s\S]*?)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, Object.keys(api).sort());
});

async function scanned(over = {}) {
  const ctx = setup(over);
  fs.mkdirSync(path.join(ctx.media, 'Movies', 'batman 2022'), { recursive: true });
  await ctx.api.addRoot(path.join(ctx.media, 'Movies'));
  await ctx.api.scan();
  await ctx.api.setSettings({ omdbKey: 'K' });
  await ctx.api.startQueue(() => {});
  const [e] = (await ctx.api.getEntries()).entries;
  return { ...ctx, e, locId: e.locations[0].id };
}

test('openLocation opens the folder on its drive; offline, deleted and unknown folders are refused', async () => {
  const opened = [];
  const { api, db, media, e, locId, state } = await scanned({ openPath: async (p) => { opened.push(p); return ''; } });
  assert.deepEqual(await api.openLocation(locId), { ok: true });
  assert.deepEqual(opened, [path.join(media, 'Movies', 'batman 2022')]);
  assert.deepEqual(await api.openLocation(99999), { ok: false, error: 'unknown' });
  fs.rmdirSync(path.join(media, 'Movies', 'batman 2022'));
  assert.deepEqual(await api.openLocation(locId), { ok: false, error: 'missing' });
  state.online = false;
  await api.getDrives();
  assert.deepEqual(await api.openLocation(locId), { ok: false, error: 'offline' });
  assert.equal(opened.length, 1);
  // unplugged after the last drive refresh: the stored flag still says online
  db.prepare('UPDATE drives SET online = 1, root = ?').run(path.join(media, 'gone') + path.sep);
  assert.deepEqual(await api.openLocation(locId), { ok: false, error: 'offline' });
  assert.ok(e);
});

test('openImdb opens the title page only for a well-formed imdb id', async () => {
  const urls = [];
  const { api, db, e } = await scanned({ openExternal: async (u) => { urls.push(u); } });
  assert.deepEqual(await api.openImdb(e.titleId), { ok: true });
  assert.deepEqual(urls, ['https://www.imdb.com/title/tt1877830/']);
  db.prepare("UPDATE titles SET imdb_id = 'x; calc.exe' WHERE id = ?").run(e.titleId);
  assert.deepEqual(await api.openImdb(e.titleId), { ok: false });
  assert.deepEqual(await api.openImdb(424242), { ok: false });
  assert.equal(urls.length, 1);
});

test('translate returns the text, stores it, and reports quota', async () => {
  const { api, fetchCalls } = setup();
  assert.deepEqual(await api.translate('Hello there.'), { ok: true, text: 'سلام' });
  const calls = fetchCalls.length;
  assert.deepEqual(await api.translate('Hello there.'), { ok: true, text: 'سلام' });
  assert.equal(fetchCalls.length, calls);
  const q = setup({ mymemory: () => ({ quotaFinished: true, responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: x' } }) });
  assert.deepEqual(await q.api.translate('Hello there.'), { ok: false, error: 'quota' });
});

test('the translate e-mail setting is sent to MyMemory', async () => {
  const { api, fetchCalls } = setup();
  await api.setSettings({ translateEmail: 'me@example.com' });
  await api.translate('Hello there.');
  assert.ok(fetchCalls.some((u) => u.includes('mymemory') && u.includes('de=me%40example.com')));
});

test('getEpisodes groups by season and turns an empty plot into null', async () => {
  const { api, db } = setup();
  const ins = db.prepare('INSERT INTO episodes(title_id, season, number, name, released, rating, plot) VALUES(1, ?, ?, ?, ?, ?, ?)');
  ins.run(2, 1, 'B1', '2009-01-01', '8.0', 'plot');
  ins.run(1, 2, 'A2', null, null, '');
  ins.run(1, 1, 'A1', null, '7.5', null);
  assert.deepEqual(await api.getEpisodes(1), [
    { season: 1, episodes: [{ number: 1, name: 'A1', released: null, rating: '7.5', plot: null }, { number: 2, name: 'A2', released: null, rating: null, plot: null }] },
    { season: 2, episodes: [{ number: 1, name: 'B1', released: '2009-01-01', rating: '8.0', plot: 'plot' }] },
  ]);
});

test('getEntries takes tab and sort and returns entries with genre counts', async () => {
  const { api } = await scanned();
  const r = await api.getEntries({ tab: 'movie', sort: 'year' });
  assert.deepEqual([r.entries.length, r.genres], [1, [{ name: 'Action', count: 1 }]]);
  assert.equal((await api.getEntries({ tab: 'series' })).entries.length, 0);
});

test('a second scan adds only the new folders and the queue asks OMDb only for them', async () => {
  const { api, media, fetchCalls } = setup();
  for (const n of ['batman 2022', 'dune 2021']) fs.mkdirSync(path.join(media, 'Movies', n), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  assert.equal((await api.scan()).added, 2);
  await api.setSettings({ omdbKey: 'K' });
  await api.startQueue(() => {});
  const asked = () => fetchCalls.filter((u) => u.includes('omdbapi.com')).length;
  const first = asked();
  const before = (await api.getEntries()).entries.map((e) => [e.title, e.status]);
  fs.mkdirSync(path.join(media, 'Movies', 'alien 1979'));
  assert.deepEqual(await api.scan(), { scanned: 1, added: 1 });
  await api.startQueue(() => {});
  assert.equal(asked(), first + 1);
  const after = (await api.getEntries()).entries;
  assert.equal(after.length, 3);
  for (const [title, status] of before) assert.equal(after.find((e) => e.title === title).status, status);
  assert.deepEqual(await api.scan(), { scanned: 1, added: 0 });
});

test('addRoot single adds one folder as a title; its siblings are not scanned; removing it removes it', async () => {
  const { api, media } = setup();
  for (const n of ['batman 2022', 'dune 2021']) fs.mkdirSync(path.join(media, 'Movies', n), { recursive: true });
  assert.deepEqual(await api.addRoot(path.join(media, 'Movies', 'batman 2022'), true), { ok: true });
  assert.deepEqual(await api.scan(), { scanned: 1, added: 1 });
  let entries = (await api.getEntries()).entries;
  assert.deepEqual(entries.map((e) => e.locations[0].relPath), ['Movies/batman 2022']);
  fs.rmSync(path.join(media, 'Movies', 'batman 2022'), { recursive: true });
  await api.scan();
  assert.equal((await api.getEntries()).entries[0].locations[0].missing, true);
  const [root] = await api.getRoots();
  assert.equal(root.single, true);
  await api.removeRoot(root.id);
  assert.equal((await api.getEntries()).entries.length, 0);
});

test('addRoot single refuses a missing path, a plain file and a drive root', async () => {
  const { api, media } = setup();
  fs.writeFileSync(path.join(media, 'a.txt'), 'x');
  assert.deepEqual(await api.addRoot(path.join(media, 'nope'), true), { ok: false, error: 'not_folder' });
  assert.deepEqual(await api.addRoot(path.join(media, 'a.txt'), true), { ok: false, error: 'not_folder' });
  assert.deepEqual(await api.addRoot(media, true), { ok: false, error: 'drive_root' });
  assert.equal((await api.getRoots()).length, 0);
});

test('stored translations survive closing and reopening the app, with no request', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-')), 'archive.db');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-'));
  const open = (fetch) => { const db = openDb(file); return { db, api: createApi({ db, userDataDir: userData, fetch, listDrives: async () => [] }) }; };
  const online = async () => ({ ok: true, status: 200, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'سلام دنیا' } }) });
  const first = open(online);
  await first.api.setSettings({ language: 'fa' });
  assert.deepEqual(await first.api.translate('Hello world.'), { ok: true, text: 'سلام دنیا' });
  first.db.close();
  const offline = open(async () => { throw new Error('no network'); });
  assert.deepEqual(await offline.api.translate('Hello world.'), { ok: true, text: 'سلام دنیا' });
  assert.equal((await offline.api.getSettings()).language, 'fa');
});

test('a collection folder with movie files is scanned into one entry per film and opens its folder', async () => {
  const opened = [];
  const { api, media } = setup({ openPath: async (p) => { opened.push(p); return ''; } });
  const dir = path.join(media, 'Movies', 'Batman Trilogy');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['batman begins 2005.mkv', 'the dark knight 2008.mkv']) fs.writeFileSync(path.join(dir, f), 'x');
  await api.addRoot(path.join(media, 'Movies'));
  assert.deepEqual(await api.scan(), { scanned: 1, added: 2 });
  await api.setSettings({ omdbKey: 'K' });
  await api.startQueue(() => {});
  const { entries } = await api.getEntries();
  const pack = entries.find((e) => e.kind === 'collection');
  assert.deepEqual([entries.length, pack.title, pack.members.length], [3, 'Batman Trilogy', 2]);
  assert.deepEqual(await api.openCollection(pack.collection.driveSerial, pack.collection.relPath), { ok: true });
  assert.deepEqual(opened, [dir]);
  // a file entry opens the folder that holds it, not the video
  const film = entries.find((e) => e.kind !== 'collection');
  assert.deepEqual(await api.openLocation(film.locations[0].id), { ok: true });
  assert.equal(opened[1], dir);
  assert.deepEqual(await api.openCollection('S1', '../../etc'), { ok: false, error: 'unknown' });
});

test('light entries carry only what a card needs; getEntry returns the whole entry by key', async () => {
  const { api, e } = await scanned();
  const light = (await api.getEntries({ light: true })).entries[0];
  assert.deepEqual(Object.keys(light).sort(), ['attention', 'badges', 'genres', 'key', 'kind', 'members', 'posterFile', 'rating', 'reason', 'tags', 'title', 'year']);
  assert.deepEqual([light.key, light.title, light.rating, light.attention, light.members], [e.key, e.title, e.rating, e.attention, 0]);
  assert.ok(JSON.stringify(light).length * 3 < JSON.stringify(e).length);
  assert.deepEqual(await api.getEntry(e.key), e);
  assert.equal(await api.getEntry('t:99999'), null);
  // counts and genres are the same as the full answer
  assert.deepEqual((await api.getEntries({ light: true })).genres, (await api.getEntries()).genres);
});

test('getEntry sees changes made after the list was built', async () => {
  const { api, e, db } = await scanned();
  db.prepare('UPDATE titles SET plot = ? WHERE id = ?').run('new plot', e.titleId);
  await api.setSettings({}); // any settings write drops the cached list
  assert.equal((await api.getEntry(e.key)).plot, 'new plot');
});

async function tagged() {
  const ctx = await scanned();
  return ctx;
}

test('addTag tags the entry, shows on light and full entries, is found by search and can be removed', async () => {
  const { api, e } = await tagged();
  assert.deepEqual(await api.addTag(e.key, '  Iranian '), { ok: true });
  assert.deepEqual(await api.addTag(e.key, 'iranian'), { ok: true });
  assert.deepEqual((await api.getEntry(e.key)).userTags, ['Iranian']);
  const light = (await api.getEntries({ light: true })).entries[0];
  assert.deepEqual(light.tags, ['Iranian']);
  assert.equal((await api.getEntries({ tags: ['iranian'] })).entries.length, 1);
  assert.equal((await api.getEntries({ tags: ['other'] })).entries.length, 0);
  assert.deepEqual(await api.getTags(), [{ name: 'Iranian', count: 1 }]);
  assert.deepEqual(await api.removeTag(e.key, 'IRANIAN'), { ok: true });
  assert.deepEqual((await api.getEntry(e.key)).userTags, []);
  assert.deepEqual(await api.getTags(), []);
});

test('addTag refuses an empty or too long tag, a collection and an unknown entry', async () => {
  const { api, e } = await tagged();
  assert.deepEqual(await api.addTag(e.key, '  '), { ok: false, error: 'empty' });
  assert.deepEqual(await api.addTag(e.key, 'x'.repeat(31)), { ok: false, error: 'too_long' });
  assert.deepEqual(await api.addTag('t:99999', 'a'), { ok: false, error: 'unknown' });
  assert.deepEqual(await api.removeTag('t:99999', 'a'), { ok: false, error: 'unknown' });
});

test('tags stay with the folder through a rescan and through an online fix', async () => {
  const ctx = await tagged();
  const { api, e } = ctx;
  await api.addTag(e.key, 'Iranian');
  await api.scan();
  assert.deepEqual((await api.getEntry(e.key)).userTags, ['Iranian']);
  await api.applyFix({ locationId: e.locations[0].id }, 'https://www.imdb.com/title/tt1877830/');
  const [after] = (await api.getEntries({ tags: ['Iranian'] })).entries;
  assert.equal(after.title, 'The Batman');
});

test('an unmatched folder can be tagged too (its key starts with l:)', async () => {
  const { api, media } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'بتمن'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  const [e] = (await api.getEntries()).entries;
  assert.match(e.key, /^l:/);
  assert.deepEqual(await api.addTag(e.key, 'ایرانی'), { ok: true });
  assert.deepEqual((await api.getEntries({ tags: ['ایرانی'] })).entries.map((x) => x.key), [e.key]);
});

test('removing an archive folder drops the tags of its films', async () => {
  const { api, db, e } = await tagged();
  await api.addTag(e.key, 'Iranian');
  const [root] = await api.getRoots();
  await api.removeRoot(root.id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tags').get().c, 0);
});

// ---- copy list ----------------------------------------------------------

async function withFilms(opts) {
  const ctx = setup(opts);
  const { media, api } = ctx;
  for (const [dir, bytes] of [['batman 2022', 3000], ['dune 2021', 2000]]) {
    fs.mkdirSync(path.join(media, 'Movies', dir, 'Subs'), { recursive: true });
    fs.writeFileSync(path.join(media, 'Movies', dir, 'movie.mkv'), Buffer.alloc(bytes, 1));
    fs.writeFileSync(path.join(media, 'Movies', dir, 'Subs', 'en.srt'), Buffer.alloc(10, 1));
  }
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  const keys = (await api.getEntries()).entries.map((e) => e.key);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-'));
  return { ...ctx, keys, dest };
}

test('planTransfer lists what will be copied and where, without writing anything', async () => {
  const { api, keys, dest } = await withFilms();
  const plan = await api.planTransfer({ keys, destDir: dest, name: 'claude' });
  assert.equal(plan.ok, true);
  assert.equal(plan.target, path.join(dest, 'claude'));
  assert.deepEqual(plan.jobs.map((j) => path.basename(j.dest)).sort(), ['batman 2022', 'dune 2021']);
  assert.equal(plan.bytes, 5020);
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual(fs.readdirSync(dest), []);
});

test('planTransfer refuses a bad folder name, a missing destination and a destination inside the archive', async () => {
  const { api, keys, dest, media } = await withFilms();
  assert.deepEqual(await api.planTransfer({ keys, destDir: dest, name: 'a/b' }), { ok: false, error: 'bad_name' });
  assert.deepEqual(await api.planTransfer({ keys, destDir: path.join(dest, 'nope'), name: 'x' }), { ok: false, error: 'bad_dest' });
  assert.deepEqual(await api.planTransfer({ keys, destDir: path.join(media, 'Movies'), name: 'x' }), { ok: false, error: 'inside_archive' });
  assert.deepEqual(await api.planTransfer({ keys: [], destDir: dest, name: 'x' }), { ok: false, error: 'nothing' });
});

test('planTransfer leaves out a film whose drive is unplugged and says why', async () => {
  const { api, keys, dest, state } = await withFilms();
  state.online = false;
  const plan = await api.planTransfer({ keys, destDir: dest, name: 'claude' });
  assert.deepEqual(plan.jobs, []);
  assert.deepEqual(plan.skipped.map((x) => x.reason), ['offline', 'offline']);
});

test('planTransfer refuses when the destination has less free space than the films need', async () => {
  const { api, keys, dest } = await withFilms({ freeSpace: () => 100 });
  assert.deepEqual(await api.planTransfer({ keys, destDir: dest, name: 'claude' }), { ok: false, error: 'no_space', needed: 5020, free: 100 });
});

test('every season of a series is copied under the series name, so two series with a "Season 1" folder do not merge', async () => {
  const { api, media } = setup();
  for (const show of ['Alpha Show', 'Beta Show']) {
    for (const season of ['Season 1', 'Season 2']) {
      fs.mkdirSync(path.join(media, 'Series', show, season), { recursive: true });
      fs.writeFileSync(path.join(media, 'Series', show, season, 'e01.mkv'), 'x');
    }
  }
  await api.addRoot(path.join(media, 'Series'));
  await api.scan();
  const keys = (await api.getEntries()).entries.map((e) => e.key);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-'));
  const plan = await api.planTransfer({ keys, destDir: out, name: 'c' });
  assert.deepEqual(plan.jobs.map((j) => path.relative(plan.target, j.dest)).sort(),
    ['Alpha Show/Season 1', 'Alpha Show/Season 2', 'Beta Show/Season 1', 'Beta Show/Season 2'].map((x) => x.split('/').join(path.sep)));
});

test('startTransfer copies the films into the new folder, reports progress and never changes the media folders', async () => {
  const { api, keys, dest, media } = await withFilms();
  const before = snapshot(media);
  const events = [];
  const r = await api.startTransfer({ keys, destDir: dest, name: 'claude' }, (p) => events.push(p));
  assert.equal(r.ok, true);
  assert.deepEqual([r.done, r.failed, r.cancelled], [2, [], false]);
  assert.equal(fs.statSync(path.join(dest, 'claude', 'batman 2022', 'movie.mkv')).size, 3000);
  assert.equal(fs.statSync(path.join(dest, 'claude', 'dune 2021', 'Subs', 'en.srt')).size, 10);
  assert.equal(snapshot(media), before);
  const copyEvents = events.filter((e) => e.type === 'copy'); // the check after the copy reports as 'verify'
  assert.ok(copyEvents.length >= 2 && events.every((e) => e.type === 'copy' || e.type === 'verify'));
  assert.deepEqual([copyEvents.at(-1).doneBytes, copyEvents.at(-1).totalBytes], [5020, 5020]);
});

test('copy progress carries the current speed and the time left', async () => {
  let t = 0;
  const { api, keys, dest } = await withFilms({ clock: () => (t += 1000) });
  const events = [];
  await api.startTransfer({ keys, destDir: dest, name: 'claude' }, (p) => events.push(p));
  const copyEvents = events.filter((e) => e.type === 'copy');
  assert.deepEqual([copyEvents[0].bytesPerSec, copyEvents[0].etaSec], [null, null]); // nothing to measure yet
  const mid = copyEvents.find((e) => e.bytesPerSec > 0);
  assert.ok(mid && Number.isInteger(mid.etaSec) && mid.etaSec >= 0);
  assert.equal(copyEvents.at(-1).etaSec, 0); // the closing event: all bytes are there
});

test('startTransfer does nothing when the plan is refused, and refuses a second run at the same time', async () => {
  const { api, keys, dest } = await withFilms();
  assert.deepEqual(await api.startTransfer({ keys, destDir: dest, name: '..' }, () => {}), { ok: false, error: 'bad_name' });
  assert.deepEqual(fs.readdirSync(dest), []);
  const first = api.startTransfer({ keys, destDir: dest, name: 'claude' }, () => {});
  assert.deepEqual(await api.startTransfer({ keys, destDir: dest, name: 'claude' }, () => {}), { ok: false, error: 'busy' });
  assert.equal((await first).ok, true);
});

test('cancelTransfer stops the run and reports it', async () => {
  const { api, keys, dest } = await withFilms();
  const run = api.startTransfer({ keys, destDir: dest, name: 'claude' }, () => api.cancelTransfer());
  const r = await run;
  assert.equal(r.cancelled, true);
});

// ---- selections and collections ----

async function withPack() {
  const ctx = setup();
  const { media, api } = ctx;
  const dir = path.join(media, 'Movies', 'Batman Trilogy');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['batman begins 2005.mkv', 'the dark knight 2008.mkv']) fs.writeFileSync(path.join(dir, f), Buffer.alloc(100, 1));
  fs.mkdirSync(path.join(media, 'Movies', 'dune 2021'));
  fs.writeFileSync(path.join(media, 'Movies', 'dune 2021', 'movie.mkv'), Buffer.alloc(50, 1));
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  const entries = (await api.getEntries()).entries;
  return { ...ctx, dir, entries, pack: entries.find((e) => e.kind === 'collection'), dune: entries.find((e) => e.title.startsWith('dune')) };
}

test('tagging a collection tags every film in it, and its tag list shows what all of them share', async () => {
  const { api, pack, entries } = await withPack();
  assert.deepEqual(await api.addTag(pack.key, 'Iranian'), { ok: true });
  assert.deepEqual((await api.getEntry(pack.key)).userTags, ['Iranian']);
  for (const m of pack.members) assert.deepEqual((await api.getEntry(m.key)).userTags, ['Iranian']);
  assert.deepEqual((await api.getEntry(entries.find((e) => e.title.startsWith('dune')).key)).userTags, []);
  assert.deepEqual(await api.removeTag(pack.key, 'iranian'), { ok: true });
  for (const m of pack.members) assert.deepEqual((await api.getEntry(m.key)).userTags, []);
});

test('addTags and removeTags change several entries at once and report how many', async () => {
  const { api, pack, dune } = await withPack();
  assert.deepEqual(await api.addTags([pack.key, dune.key, 't:99999'], 'ایرانی'), { ok: true, count: 2 });
  assert.equal((await api.getEntries({ tags: ['ایرانی'] })).entries.length, 4); // two films, the pack, dune
  assert.deepEqual(await api.removeTags([dune.key], 'ایرانی'), { ok: true, count: 1 });
  assert.equal((await api.getEntries({ tags: ['ایرانی'] })).entries.length, 3);
  assert.deepEqual(await api.addTags([], 'x'), { ok: false, error: 'nothing' });
  assert.deepEqual(await api.addTags([dune.key], ' '), { ok: false, error: 'empty' });
  assert.deepEqual(await api.addTags([dune.key], 'x'.repeat(31)), { ok: false, error: 'too_long' });
});

test('a collection in the copy list copies its whole folder as one item', async () => {
  const { api, pack, dune, dir } = await withPack();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-'));
  const plan = await api.planTransfer({ keys: [pack.key, dune.key], destDir: dest, name: 'claude' });
  assert.deepEqual(plan.jobs.map((j) => path.basename(j.dest)).sort(), ['Batman Trilogy', 'dune 2021']);
  assert.equal(plan.jobs.find((j) => j.src === dir).bytes, 200);
  const r = await api.startTransfer({ keys: [pack.key, dune.key], destDir: dest, name: 'claude' }, () => {});
  assert.equal(r.done, 2);
  assert.deepEqual(fs.readdirSync(path.join(dest, 'claude', 'Batman Trilogy')).sort(), ['batman begins 2005.mkv', 'the dark knight 2008.mkv']);
});

test('a film and the collection that holds it are copied once, not twice', async () => {
  const { api, pack } = await withPack();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-'));
  const plan = await api.planTransfer({ keys: [pack.key, pack.members[0].key], destDir: dest, name: 'claude' });
  assert.equal(plan.jobs.length, 1);
});

// ---- drag and drop ----

test('dropping a folder adds it as one single folder and the scan finds it', async () => {
  const { api, media } = setup();
  fs.mkdirSync(path.join(media, 'Downloads', 'dune 2021'), { recursive: true });
  fs.writeFileSync(path.join(media, 'Downloads', 'dune 2021', 'movie.mkv'), 'x');
  const r = await api.addDropped([path.join(media, 'Downloads', 'dune 2021')]);
  assert.deepEqual(r, { added: 1, already: 0, failed: [] });
  const [root] = await api.getRoots();
  assert.deepEqual([root.relPath, root.single], ['Downloads/dune 2021', true]);
  assert.deepEqual(await api.scan(), { scanned: 1, added: 1 });
});

test('dropping a video file adds the folder that holds it', async () => {
  const { api, media } = setup();
  fs.mkdirSync(path.join(media, 'Downloads', 'dune 2021'), { recursive: true });
  fs.writeFileSync(path.join(media, 'Downloads', 'dune 2021', 'movie.mkv'), 'x');
  const r = await api.addDropped([path.join(media, 'Downloads', 'dune 2021', 'movie.mkv')]);
  assert.deepEqual([r.added, (await api.getRoots())[0].relPath], [1, 'Downloads/dune 2021']);
});

test('dropping something an archive folder already covers adds nothing; dropping it twice adds it once', async () => {
  const { api, media } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'dune 2021'), { recursive: true });
  fs.mkdirSync(path.join(media, 'Other', 'alien 1979'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  assert.deepEqual(await api.addDropped([path.join(media, 'Movies', 'dune 2021')]), { added: 0, already: 1, failed: [] });
  const twice = path.join(media, 'Other', 'alien 1979');
  assert.deepEqual(await api.addDropped([twice, twice]), { added: 1, already: 1, failed: [] });
  assert.equal((await api.getRoots()).length, 2);
});

test('dropping a non-video file, a missing path or a path outside every drive is reported, not added', async () => {
  const { api, media } = setup();
  fs.writeFileSync(path.join(media, 'note.txt'), 'x');
  fs.mkdirSync(path.join(media, 'D'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-'));
  fs.writeFileSync(path.join(media, 'movie.mkv'), 'x');
  const r = await api.addDropped([path.join(media, 'note.txt'), path.join(media, 'nope'), outside, path.join(media, 'movie.mkv')]);
  assert.deepEqual(r.failed.map((f) => f.error), ['not_media', 'not_found', 'no_drive', 'drive_root']);
  assert.equal(r.added, 0);
  assert.deepEqual(await api.getRoots(), []);
});

// ---- background translation ----

test('startPretranslate translates stored plots with the saved e-mail, reports progress and refuses a second run', async () => {
  const urls = [];
  const { api, db } = setup({ mymemory: (url) => { urls.push(String(url)); return { responseStatus: 200, responseData: { translatedText: 'خلاصه' } }; }, translatePause: 0 });
  await api.setSettings({ translateEmail: 'me@example.com' });
  for (const [i, plot] of ['A first plot.', 'A second plot.'].entries()) {
    db.prepare("INSERT INTO titles(imdb_id, source, title, plot) VALUES(?, 'omdb', ?, ?)").run(`tt${i}`, `T${i}`, plot);
  }
  const seen = [];
  const run = api.startPretranslate((p) => seen.push(p));
  assert.deepEqual(await api.startPretranslate(() => {}), { ok: false, error: 'busy' });
  const r = await run;
  assert.deepEqual([r.ok, r.translated, r.remaining, r.stoppedBy], [true, 2, 0, null]);
  assert.ok(seen.length === 2 && seen.every((p) => p.type === 'translate' && p.total === 2));
  assert.ok(urls.every((u) => u.includes('de=me%40example.com')));
  assert.equal((await api.translate('A first plot.')).text, 'خلاصه'); // now answered from the stored translation
  assert.equal(urls.length, 2);
});

test('autoTranslate is a setting that is on by default', async () => {
  const { api } = setup();
  assert.equal((await api.getSettings()).autoTranslate, true);
  await api.setSettings({ autoTranslate: false });
  assert.equal((await api.getSettings()).autoTranslate, false);
});

// 2026-11-23 is a Monday; the api reads the clock through the injected `now`
const clock = { t: new Date(2026, 10, 21, 12, 0).getTime() };
const atT = (d, h = 0) => new Date(2026, 10, d, h).getTime();

test('calendar: add, list, tick and skip go through the api with the injected clock', async () => {
  const { api } = setup({ now: () => clock.t });
  clock.t = atT(21, 12);
  const r = await api.calendarAdd({ title: 'بامداد خمار', weekday: 1, time: '20:00', episode: 7 });
  assert.equal(r.ok, true);
  assert.equal((await api.calendarList())[0].state, 'soon');
  clock.t = atT(23, 21);
  assert.equal((await api.calendarList())[0].state, 'out');
  assert.deepEqual(await api.calendarTick(r.id), { ok: true });
  const [x] = await api.calendarList();
  assert.deepEqual([x.episode, x.state, x.due], [8, 'soon', atT(30, 20)]);
  assert.deepEqual(await api.calendarSkip(r.id), { ok: true });
  assert.equal((await api.calendarList())[0].due, new Date(2026, 11, 7, 20).getTime());
});

test('calendar: update and remove, bad input is refused with a reason', async () => {
  const { api } = setup({ now: () => clock.t });
  clock.t = atT(21, 12);
  const { id } = await api.calendarAdd({ title: 'X', weekday: 1, time: '20:00' });
  assert.deepEqual(await api.calendarUpdate(id, { title: 'Y', episode: 4 }), { ok: true });
  assert.deepEqual(await api.calendarUpdate(id, { time: 'nope' }), { ok: false, error: 'bad_time' });
  assert.equal((await api.calendarList())[0].title, 'Y');
  await api.calendarRemove(id);
  assert.deepEqual(await api.calendarList(), []);
});

test('getAiring: a running series can be added, an ended one and a film cannot; adding links the reminder to the entry', async () => {
  const { api, db, e } = await scanned({ now: () => clock.t });
  clock.t = atT(21, 12);
  assert.equal((await api.getAiring(e.key)).canAir, false); // a film
  db.prepare("UPDATE titles SET type = 'series', year = '2019–2022' WHERE id = ?").run(e.titleId);
  await api.setSettings({});
  assert.deepEqual(await api.getAiring(e.key), { canAir: false, ended: true, reminder: null });
  db.prepare("UPDATE titles SET year = '2019–' WHERE id = ?").run(e.titleId);
  await api.setSettings({});
  assert.deepEqual(await api.getAiring(e.key), { canAir: true, ended: false, reminder: null });
  const r = await api.calendarAdd({ key: e.key, weekday: 1, time: '22:00', episode: 3 });
  assert.equal(r.ok, true);
  const air = await api.getAiring(e.key);
  assert.deepEqual([air.reminder.title, air.reminder.episode], [e.title, 3]); // title defaults to the entry's
  assert.equal((await api.calendarAdd({ key: e.key, weekday: 2, time: '22:00' })).error, 'exists');
  assert.equal((await api.getAiring('t:99999')).canAir, false);
});

// ---- copies: checked after copying, verified later, repaired from the source ----

async function copied(opts) {
  const ctx = await withFilms(opts);
  const events = [];
  const r = await ctx.api.startTransfer({ keys: ctx.keys, destDir: ctx.dest, name: 'claude' }, (p) => events.push(p));
  const target = path.join(ctx.dest, 'claude');
  const [c] = await ctx.api.getCopies();
  return { ...ctx, r, events, target, id: c?.id, c };
}
const mkv = (target, dir) => path.join(target, dir, 'movie.mkv');

test('a finished copy is checked at once, recorded under the folder name and listed', async () => {
  const { r, events, c, target } = await copied();
  assert.equal(r.ok, true);
  assert.deepEqual([r.verify.state, r.verify.checked, r.verify.problems, r.verify.repaired], ['ok', 4, [], 0]);
  assert.deepEqual([c.name, c.target, c.files, c.bytes, c.state], ['claude', target, 4, 5020, 'ok']);
  assert.ok(events.some((p) => p.type === 'verify'));
});

test('verifyCopy: quick sees a missing file, deep also sees changed bytes; the verdict is stored', async () => {
  const { api, id, target } = await copied();
  fs.rmSync(path.join(target, 'batman 2022', 'Subs', 'en.srt'));
  fs.writeFileSync(mkv(target, 'dune 2021'), Buffer.alloc(2000, 2)); // same size, other bytes
  const quick = await api.verifyCopy(id, { deep: false });
  assert.deepEqual([quick.state, quick.problems.map((p) => p.files.map((f) => f.reason))], ['problem', [['missing']]]);
  const deep = await api.verifyCopy(id, { deep: true });
  assert.deepEqual(deep.problems.flatMap((p) => p.files.map((f) => f.reason)).sort(), ['hash', 'missing']);
  assert.equal((await api.getCopies())[0].state, 'problem');
});

test('repairCopy copies broken files again from the source, checks them, and never touches the media folders', async () => {
  const { api, id, target, media } = await copied();
  const before = snapshot(media);
  fs.rmSync(path.join(target, 'batman 2022', 'Subs', 'en.srt'));
  fs.writeFileSync(mkv(target, 'dune 2021'), Buffer.alloc(2000, 2));
  const r = await api.repairCopy(id);
  assert.deepEqual([r.ok, r.repaired, r.verify.state, r.verify.problems], [true, 2, 'ok', []]);
  assert.deepEqual(fs.readFileSync(mkv(target, 'dune 2021')), Buffer.alloc(2000, 1));
  assert.equal(fs.existsSync(path.join(target, 'batman 2022', 'Subs', 'en.srt')), true);
  assert.equal(snapshot(media), before);
  assert.equal((await api.getCopies())[0].state, 'ok');
});

test('repairCopy with the source drive unplugged reports the film, keeps the damaged file and leaves the copy marked as a problem', async () => {
  const { api, id, target, state } = await copied();
  fs.writeFileSync(mkv(target, 'dune 2021'), Buffer.alloc(2000, 2));
  state.online = false;
  const r = await api.repairCopy(id);
  assert.deepEqual([r.repaired, r.failed.map((f) => f.reason), r.verify.state], [0, ['offline'], 'problem']);
  assert.equal(fs.existsSync(mkv(target, 'dune 2021')), true);
  assert.equal(r.verify.problems.length, 1);
});

test('copying again into the same folder repairs what an earlier run left damaged', async () => {
  const { api, keys, dest, target } = await copied();
  fs.writeFileSync(mkv(target, 'dune 2021'), Buffer.alloc(2000, 2));
  const r = await api.startTransfer({ keys, destDir: dest, name: 'claude' });
  assert.deepEqual([r.verify.state, r.verify.repaired], ['ok', 1]);
  assert.deepEqual(fs.readFileSync(mkv(target, 'dune 2021')), Buffer.alloc(2000, 1));
  assert.equal((await api.getCopies()).length, 1);
});

test('repairCopy refuses a recorded path that leads out of the copy folder', async () => {
  const { api, db, id, dest } = await copied();
  db.prepare("UPDATE copy_files SET rel = '../evil.mkv' WHERE copy_id = ? AND rel LIKE 'dune%movie.mkv'").run(id);
  const r = await api.repairCopy(id);
  assert.ok(r.failed.some((f) => f.reason === 'bad_path'));
  assert.equal(fs.existsSync(path.join(dest, 'evil.mkv')), false);
});

test('removeCopy forgets the record and leaves the files; verify and repair are refused while a copy runs', async () => {
  const { api, id, target, keys, dest } = await copied();
  const running = api.startTransfer({ keys, destDir: dest, name: 'other' });
  assert.deepEqual(await api.verifyCopy(id, { deep: true }), { ok: false, error: 'busy' });
  assert.deepEqual(await api.repairCopy(id), { ok: false, error: 'busy' });
  await running;
  assert.deepEqual(await api.removeCopy(id), { ok: true });
  assert.deepEqual((await api.getCopies()).map((c) => c.name), ['other']);
  assert.equal(fs.existsSync(mkv(target, 'dune 2021')), true);
  assert.deepEqual(await api.verifyCopy(id, { deep: true }), { ok: false, error: 'unknown' });
});

test('copy lists are saved and come back; junk in them is dropped, not stored', async () => {
  const { api } = setup();
  assert.deepEqual(await api.getCopyLists(), []);
  const good = { id: 'a1', name: 'claude', dest: 'E:\\Out', items: [['t:1', 'Dune'], ['c:S|Trilogy', 'Trilogy']] };
  await api.saveCopyLists([good, { id: 'b2', name: 'فلش علی', dest: '', items: [] }]);
  assert.deepEqual((await api.getCopyLists()).map((l) => [l.id, l.name, l.dest, l.items.length]), [['a1', 'claude', 'E:\\Out', 2], ['b2', 'فلش علی', '', 0]]);
  await api.saveCopyLists([good, 'x', null, { id: 5, name: 'bad' }, { id: 'c3', name: 'ok', dest: 7, items: [['t:2', 'A'], 'junk', [1, 2], ['t:3']] }]);
  const saved = await api.getCopyLists();
  assert.deepEqual(saved.map((l) => l.id), ['a1', 'c3']);
  assert.deepEqual([saved[1].dest, saved[1].items], ['', [['t:2', 'A']]]);
});

test('getVersion returns the version the app was started with', async () => {
  const { api } = setup({ version: '1.2.3' });
  assert.equal(await api.getVersion(), '1.2.3');
});

test('the update calls are passed to the updater, progress goes to the callback', async () => {
  const calls = [];
  const updater = {
    check: async () => ({ state: 'available', version: '9.9.9' }),
    download: async (onProgress) => { onProgress({ type: 'update', percent: 40 }); return { state: 'ready' }; },
    install: () => calls.push('install'),
  };
  const { api } = setup({ updater });
  assert.deepEqual(await api.checkUpdate(), { state: 'available', version: '9.9.9' });
  const seen = [];
  assert.deepEqual(await api.downloadUpdate((p) => seen.push(p)), { state: 'ready' });
  assert.deepEqual(seen, [{ type: 'update', percent: 40 }]);
  api.installUpdate();
  assert.deepEqual(calls, ['install']);
});

test('getSimilar lists the other films that share genre or people, as card-sized entries with reasons', async () => {
  const { api } = await withFilms();
  await api.setSettings({ omdbKey: 'K' });
  await api.startQueue(() => {}); // both folders get their OMDb data (the same genre) and become titles
  const keys = (await api.getEntries()).entries.map((e) => e.key);
  const r = await api.getSimilar(keys[0]);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.notEqual(r.items[0].key, keys[0]);
  assert.ok(r.items[0].score > 0 && r.items[0].reasons.some((x) => x.type === 'genre'));
  assert.equal('plot' in r.items[0], false); // card fields only, like the grid
  assert.deepEqual(await api.getSimilar('t:99999'), { ok: false, error: 'unknown' });
});

// two matched titles; the first is anime 100 on MyAnimeList, the second anime 200
async function withAnime(opts = {}) {
  const ctx = await withFilms(opts);
  await ctx.api.setSettings({ omdbKey: 'K' });
  await ctx.api.startQueue(() => {});
  // the queue runs in parallel, so ids are not in folder order: 'The Batman' first, 'dune' second
  const titles = ctx.db.prepare('SELECT id, title FROM titles').all().sort((a, b) => (a.title === 'dune') - (b.title === 'dune'));
  ctx.db.prepare('UPDATE titles SET mal_id = 100 WHERE id = ?').run(titles[0].id);
  ctx.db.prepare('UPDATE titles SET mal_id = 200 WHERE id = ?').run(titles[1].id);
  ctx.api.getEntries(); // keep the search cache honest
  return { ...ctx, titles, keys: titles.map((t) => `t:${t.id}`) };
}
const REC = (id, title, votes) => ({ entry: { mal_id: id, title, images: { jpg: { large_image_url: `https://x/${id}.jpg` } } }, votes });

test('getRecommendations splits MyAnimeList recommendations into films in the archive and films outside it', async () => {
  const { api, keys, fetchCalls, userData } = await withAnime({ jikan: () => [REC(300, 'Outside Few', 3), REC(200, 'In Archive', 90), REC(400, 'Outside Many', 40)] });
  await api.scan(); // a rescan must not matter
  const r = await api.getRecommendations(keys[0]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.inArchive.map((x) => [x.key, x.votes]), [[keys[1], 90]]);
  assert.deepEqual(r.outside.map((x) => [x.malId, x.title, x.votes, x.posterFile]), [[400, 'Outside Many', 40, 'mal400.jpg'], [300, 'Outside Few', 3, 'mal300.jpg']]);
  assert.equal(fs.existsSync(path.join(userData, 'posters', 'mal400.jpg')), true);
  const calls = fetchCalls.filter((u) => u.includes('jikan.moe')).length;
  await api.getRecommendations(keys[0]);
  assert.equal(fetchCalls.filter((u) => u.includes('jikan.moe')).length, calls); // the second time comes from the stored answer
});

test('getRecommendations matches an archive film by its name when it has no MyAnimeList id', async () => {
  const { api, db, keys, titles } = await withAnime({ jikan: () => [REC(999, 'dune', 10)] });
  db.prepare('UPDATE titles SET mal_id = NULL WHERE id = ?').run(titles[1].id);
  await api.scan(); // forgets the cached entries
  const r = await api.getRecommendations(keys[0]);
  assert.deepEqual([r.inArchive.map((x) => x.key), r.outside.length], [[keys[1]], 0]);
});

test('getRecommendations says not_anime for a film, and unknown for a key it does not have', async () => {
  const { api, db, keys, titles } = await withAnime();
  db.prepare('UPDATE titles SET mal_id = NULL WHERE id = ?').run(titles[0].id); // an OMDb film with genre Action
  await api.scan();
  assert.deepEqual(await api.getRecommendations(keys[0]), { ok: false, error: 'not_anime' });
  assert.deepEqual(await api.getRecommendations('t:99999'), { ok: false, error: 'unknown' });
});

test('getRecommendations finds the MyAnimeList entry of an OMDb animation by its exact name, and refuses a different one', async () => {
  const anime = (title) => [{ mal_id: 100, title, title_english: title, images: {} }];
  for (const [found, ok] of [['The Batman', true], ['Batman Ninja', false]]) {
    const { api, db, keys, titles } = await withAnime({ jikan: (u) => (u.includes('recommendations') ? [REC(300, 'Other', 5)] : anime(found)) });
    db.prepare("UPDATE titles SET mal_id = NULL, genres = 'Animation' WHERE id = ?").run(titles[0].id);
    await api.scan();
    const r = await api.getRecommendations(keys[0]);
    assert.deepEqual(ok ? [r.ok, r.outside.length] : [r.ok, r.error], ok ? [true, 1] : [false, 'not_found']);
  }
});

test('getRecommendations answers network when MyAnimeList cannot be reached, and stores nothing', async () => {
  const { api, keys, fetchCalls } = await withAnime({ jikan: () => 'offline' });
  assert.deepEqual(await api.getRecommendations(keys[0]), { ok: false, error: 'network' });
  const before = fetchCalls.length;
  await api.getRecommendations(keys[0]);
  assert.ok(fetchCalls.length > before); // asked again, an error is not remembered
});

test('aliases: other names are added to the entry, searched, kept through a rescan and removed', async () => {
  const { api, e } = await tagged();
  assert.deepEqual(await api.addAlias(e.key, '  ديپارتد '), { ok: true });
  assert.deepEqual(await api.addAlias(e.key, 'ديپارتد'), { ok: true });
  assert.deepEqual((await api.getEntry(e.key)).aliases, ['ديپارتد']);
  assert.equal((await api.getEntries({ query: 'دیپارتد' })).entries[0].key, e.key);
  await api.scan();
  assert.deepEqual((await api.getEntry(e.key)).aliases, ['ديپارتد']);
  assert.deepEqual(await api.removeAlias(e.key, 'ديپارتد'), { ok: true });
  assert.deepEqual((await api.getEntry(e.key)).aliases, []);
  assert.deepEqual(await api.addAlias(e.key, ' '), { ok: false, error: 'empty' });
  assert.deepEqual(await api.addAlias(e.key, 'x'.repeat(81)), { ok: false, error: 'too_long' });
  assert.deepEqual(await api.addAlias('t:99999', 'a'), { ok: false, error: 'unknown' });
});

test('getSingleDrive lists what lives on one drive only', async () => {
  const { api, e } = await scanned();
  const groups = await api.getSingleDrive();
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((i) => i.key), [e.key]);
});

test('getSeriesGaps answers with entry keys and counts', async () => {
  const { api } = await scanned();
  const r = await api.getSeriesGaps();
  assert.deepEqual([r.entries, typeof r.checked, typeof r.offline, typeof r.unreadable], [[], 'number', 'number', 'number']);
});

test('backup: exportBackup writes a file importBackup reads; a foreign file is refused', async () => {
  const { api, e, media } = await scanned();
  await api.addTag(e.key, 'Iranian');
  await api.addAlias(e.key, 'بتمن');
  const file = path.join(media, 'backup.json');
  assert.deepEqual(await api.exportBackup(file), { ok: true });
  await api.removeTag(e.key, 'Iranian');
  const r = await api.importBackup(file);
  assert.equal(r.ok, true);
  assert.deepEqual((await api.getEntry(e.key)).userTags, ['Iranian']);
  fs.writeFileSync(file, '{"hello":1}');
  assert.deepEqual(await api.importBackup(file), { ok: false, error: 'not_a_backup' });
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(await api.importBackup(file), { ok: false, error: 'not_a_backup' });
  assert.deepEqual(await api.importBackup(path.join(media, 'nothing.json')), { ok: false, error: 'unreadable' });
});

test('a finished copy becomes an order with the customer, its films and the price; the plan shows the price first', async () => {
  const { api, keys, dest } = await withFilms({ now: () => 5000 });
  await api.setSettings({ pricePerGB: 0, priceMovie: 7000, priceSeason: 0, shopName: 'Net' });
  const plan = await api.planTransfer({ keys, destDir: dest, name: 'c' });
  assert.deepEqual([plan.price.movies, plan.price.total], [2, 14000]);
  const r = await api.startTransfer({ keys, destDir: dest, name: 'c', customer: ' Ali ', phone: '0912', note: 'flash' }, () => {});
  assert.equal(r.ok, true);
  assert.equal(typeof r.orderId, 'number');
  const [order] = await api.getOrders();
  assert.deepEqual([order.id, order.customer, order.phone, order.note, order.created, order.price, order.bytes], [r.orderId, 'Ali', '0912', 'flash', 5000, 14000, 5020]);
  assert.deepEqual(order.items.map((i) => i.title).sort(), ['batman', 'dune']);
  assert.deepEqual((await api.getSettings()).shopName, 'Net');
  assert.deepEqual((await api.getCustomers()).map((c) => [c.name, c.orders]), [['Ali', 1]]);
  // delivery history: the same customer is warned about what they already have
  const seen = await api.getDelivered({ customer: 'ali', keys });
  assert.deepEqual(Object.keys(seen).sort(), [...keys].sort());
  assert.deepEqual(await api.getDelivered({ customer: 'Sara', keys }), {});
  assert.deepEqual(await api.removeOrder(order.id), { ok: true });
  assert.deepEqual(await api.getOrders(), []);
});

test('a copy that delivered nothing makes no order; price settings are numbers', async () => {
  const { api, keys, dest } = await withFilms();
  await api.setSettings({ pricePerGB: 'abc', priceMovie: -5, priceSeason: '1500' });
  const s = await api.getSettings();
  assert.deepEqual([s.pricePerGB, s.priceMovie, s.priceSeason], [0, 0, 1500]);
  assert.deepEqual(await api.startTransfer({ keys, destDir: dest, name: '..' }, () => {}), { ok: false, error: 'bad_name' });
  assert.deepEqual(await api.getOrders(), []);
});

test('removable drives are listed and only they can be ejected', async () => {
  const ejected = [];
  const { api } = setup({ listRemovable: async () => [{ root: 'F:\\', label: 'FLASH', size: 100, free: 40 }], eject: async (root) => { ejected.push(root); return { ok: true }; } });
  assert.deepEqual(await api.getRemovable(), [{ root: 'F:\\', label: 'FLASH', size: 100, free: 40 }]);
  assert.deepEqual(await api.ejectDrive('F:\\'), { ok: true });
  assert.deepEqual(await api.ejectDrive('C:\\'), { ok: false, error: 'not_removable' });
  assert.deepEqual(ejected, ['F:\\']);
});

test('requests count up, say when the film is already in the archive, and can be removed', async () => {
  const { api, e } = await scanned();
  const miss = await api.addRequest('Dune Part Two');
  assert.deepEqual([miss.ok, miss.count, miss.inArchive], [true, 1, []]);
  assert.equal((await api.addRequest('dune  part two')).count, 2);
  const have = await api.addRequest(e.title);
  assert.deepEqual(have.inArchive.map((x) => x.key), [e.key]);
  assert.deepEqual((await api.getRequests()).map((r) => [r.name, r.count]), [['Dune Part Two', 2], [e.title, 1]]);
  assert.deepEqual(await api.addRequest('  '), { ok: false, error: 'empty' });
  assert.deepEqual(await api.removeRequest(miss.id), { ok: true });
  assert.equal((await api.getRequests()).length, 1);
});

test('estimateSize gives the size and price of a list before any destination is chosen; getFreeSpace reports the destination', async () => {
  const { api, keys, dest } = await withFilms({ freeSpace: () => 777 });
  await api.setSettings({ priceMovie: 100 });
  const est = await api.estimateSize(keys);
  assert.deepEqual([est.bytes, est.count, est.price.total], [5020, 2, 200]);
  assert.deepEqual(await api.estimateSize([]), { bytes: 0, count: 0, price: null });
  assert.equal(await api.getFreeSpace(dest), 777);
  assert.equal(await api.getFreeSpace(path.join(dest, 'nope')), null);
});

test('phone catalog: off by default, serves films without paths, takes customer lists, stops again', async () => {
  const { api } = await withFilms({ qr: async (text) => `qr:${text}`, lanAddress: () => '192.168.1.20' });
  await api.setSettings({ catalogPort: 0 });
  assert.deepEqual(await api.getCatalogInfo(), { running: false });
  const r = await api.startCatalog();
  try {
    assert.equal(r.ok, true);
    assert.match(r.url, /^http:\/\/192\.168\.1\.20:\d+$/);
    assert.equal(r.qr, `qr:${r.url}`);
    assert.equal((await api.getSettings()).phoneCatalog, true);
    const base = `http://127.0.0.1:${new URL(r.url).port}`;
    const films = await (await fetch(`${base}/api/films`)).json();
    assert.equal(films.length, 2);
    assert.ok(!JSON.stringify(films).match(/Movies|media-|batman 2022/));
    const key = films[0].k;
    const sent = await fetch(`${base}/api/wish`, { method: 'POST', body: JSON.stringify({ name: 'Ali', phone: '0912', keys: [key] }) });
    assert.equal(sent.status, 200);
    const wishes = await api.getWishes();
    assert.equal(wishes.length, 1);
    assert.deepEqual([wishes[0].name, wishes[0].phone, wishes[0].items[0].key], ['Ali', '0912', key]);
    assert.deepEqual(await api.removeWish(wishes[0].id), { ok: true });
    assert.deepEqual(await api.getWishes(), []);
  } finally {
    assert.deepEqual(await api.stopCatalog(), { ok: true });
  }
  assert.equal((await api.getSettings()).phoneCatalog, false);
});

test('phone catalog starts at launch only when it was left on', async () => {
  const { api } = await withFilms({ qr: async () => 'q', lanAddress: () => '10.0.0.5' });
  await api.setSettings({ catalogPort: 0 });
  assert.equal((await api.initCatalog()).running, false);
  await api.setSettings({ phoneCatalog: true });
  try {
    assert.equal((await api.initCatalog()).running, true);
  } finally { await api.stopCatalog(); }
});

test('phone catalog rows: persian genres, persian name from a folder, no paths; asking for a film we have is not demand', async () => {
  const { api, media } = await withFilms({ qr: async () => 'q', lanAddress: () => '10.0.0.5' });
  fs.mkdirSync(path.join(media, 'Movies', 'بتمن آغاز می‌کند 2005 دوبله فارسی'), { recursive: true });
  fs.writeFileSync(path.join(media, 'Movies', 'بتمن آغاز می‌کند 2005 دوبله فارسی', 'a.mkv'), 'x');
  await api.scan();
  await api.setSettings({ omdbKey: 'K', catalogPort: 0 });
  await api.startQueue(() => {});
  const r = await api.startCatalog();
  try {
    const base = `http://127.0.0.1:${new URL(r.url).port}`;
    const fa = await (await fetch(`${base}/api/films?lang=fa`)).json();
    const en = await (await fetch(`${base}/api/films?lang=en`)).json();
    assert.deepEqual(fa.find((f) => f.g.includes('اکشن'))?.g.slice(0, 1), ['اکشن']);
    assert.ok(en.find((f) => f.g.includes('Action')));
    assert.ok(fa.some((f) => f.a.some((n) => n.includes('بتمن آغاز'))));
    assert.ok(!JSON.stringify(fa).match(/دوبله|Movies|media-/));
    assert.ok(fa.every((f) => ['movie', 'series', 'anime'].includes(f.kd) && Number.isInteger(f.o)));
    const ask = (name) => fetch(`${base}/api/ask`, { method: 'POST', body: JSON.stringify({ name }) }).then((x) => x.json());
    assert.deepEqual(await ask('Dune'), { ok: true, inArchive: [fa.find((f) => /dune/i.test(f.t)).t] });
    assert.deepEqual(await api.getRequests(), []);
    assert.deepEqual(await ask('Some Film We Lack'), { ok: true, inArchive: [] });
    assert.deepEqual((await api.getRequests()).map((x) => [x.name, x.count]), [['Some Film We Lack', 1]]);
  } finally { await api.stopCatalog(); }
});

test('setQualityMark: dub and sub can be added or removed by hand, together, and reset to automatic', async () => {
  const { api, media } = await withFilms();
  fs.mkdirSync(path.join(media, 'Movies', 'rocky 1976 دوبله فارسی'), { recursive: true });
  fs.writeFileSync(path.join(media, 'Movies', 'rocky 1976 دوبله فارسی', 'a.mkv'), 'x');
  await api.scan();
  const find = async () => (await api.getEntries()).entries.find((e) => e.locations.some((l) => l.folderName.includes('rocky')));
  const e = await find();
  assert.equal(e.quality.dub, true);
  assert.deepEqual(await api.setQualityMark(e.key, 'dub', false), { ok: true });
  assert.deepEqual([(await find()).quality.dub, (await find()).qualityMarks], [false, { dub: false }]);
  assert.equal((await api.getEntries({ quality: ['dub'] })).entries.some((x) => x.key === e.key), false);
  await api.setQualityMark(e.key, 'sub', true);
  await api.setQualityMark(e.key, 'dub', true);
  assert.deepEqual([(await find()).quality.dub, (await find()).quality.sub], [true, true]);
  assert.equal((await api.getEntries({ quality: ['dub', 'sub'] })).entries.some((x) => x.key === e.key), true);
  assert.deepEqual(await api.setQualityMark(e.key, 'dub', null), { ok: true });
  assert.deepEqual((await find()).qualityMarks, { sub: true });
  // marks stay with the folder through a rescan
  await api.scan();
  assert.deepEqual((await find()).qualityMarks, { sub: true });
  assert.deepEqual(await api.setQualityMark(e.key, 'loud', true), { ok: false, error: 'bad_flag' });
  assert.deepEqual(await api.setQualityMark('t:99999', 'dub', true), { ok: false, error: 'unknown' });
});

test('confirmGuess: the tick makes a guessed match verified and pins it', async () => {
  const { api, db } = await withFilms();
  await api.setSettings({ omdbKey: 'K' });
  await api.startQueue(() => {});
  const find = async () => (await api.getEntries()).entries.find((e) => e.locations.some((l) => l.folderName.includes('dune')));
  const e = await find();
  db.prepare("UPDATE locations SET guessed = 1 WHERE folder_name LIKE 'dune%'").run();
  await api.scan(); // a scan drops the cached list
  assert.equal((await find()).attention, 'guess');
  assert.deepEqual(await api.confirmGuess(e.key), { ok: true });
  assert.equal((await find()).attention, 'ok');
  assert.equal(db.prepare("SELECT pinned FROM locations WHERE folder_name LIKE 'dune%'").get().pinned, 1);
  assert.deepEqual(await api.confirmGuess('t:99999'), { ok: false, error: 'unknown' });
});
