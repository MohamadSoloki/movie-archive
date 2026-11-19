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
      const body = t && t !== 'batman' ? { ...OMDB_BODY, imdbID: 'tt7654321', Title: t, Poster: 'N/A' } : OMDB_BODY;
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
  assert.deepEqual(await api.scan(), { scanned: 1 });
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
  await api.removeRoot(movies.id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM episodes').get().c, 0);
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
  const { api, media, e, locId, state } = await scanned({ openPath: async (p) => { opened.push(p); return ''; } });
  assert.deepEqual(await api.openLocation(locId), { ok: true });
  assert.deepEqual(opened, [path.join(media, 'Movies', 'batman 2022')]);
  assert.deepEqual(await api.openLocation(99999), { ok: false, error: 'unknown' });
  fs.rmdirSync(path.join(media, 'Movies', 'batman 2022'));
  assert.deepEqual(await api.openLocation(locId), { ok: false, error: 'missing' });
  state.online = false;
  await api.getDrives();
  assert.deepEqual(await api.openLocation(locId), { ok: false, error: 'offline' });
  assert.equal(opened.length, 1);
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
