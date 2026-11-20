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

function setup({ key = 'K', openPath, openExternal, mymemory } = {}) {
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
    if (String(url).includes('mymemory')) return { ok: true, status: 200, json: async () => (mymemory ? mymemory(url) : { responseStatus: 200, responseData: { translatedText: 'سلام' } }) };
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9, 9]).buffer };
  };
  const db = openDb();
  const state = { online: true };
  const api = createApi({
    db, userDataDir: userData, fetch, openPath, openExternal,
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
  assert.deepEqual(Object.keys(light).sort(), ['attention', 'genres', 'key', 'kind', 'members', 'posterFile', 'rating', 'reason', 'title', 'year']);
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
