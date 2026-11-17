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

function setup({ key = 'K' } = {}) {
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
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9, 9]).buffer };
  };
  const api = createApi({
    db: openDb(), userDataDir: userData, fetch,
    listDrives: async () => [{ serial: 'S1', label: 'Test', root: media + path.sep }],
  });
  return { api, media, userData, fetchCalls, key };
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
  const entries = await api.getEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries.find((e) => e.title === 'Empty').locations[0].isEmpty, true);
});

test('startQueue without an OMDb key stops with bad_key and sends no request', async () => {
  const { api, media, fetchCalls } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'batman 2022'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  const r = await api.startQueue(() => {});
  assert.deepEqual(r, { processed: 0, remaining: 1, stoppedBy: 'bad_key' });
  assert.equal(fetchCalls.length, 0);
});

test('startQueue with a key matches the folder and saves the poster under userData', async () => {
  const { api, media, userData } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'batman 2022'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  await api.setSettings({ omdbKey: 'K' });
  const r = await api.startQueue(() => {});
  assert.deepEqual(r, { processed: 1, remaining: 0, stoppedBy: null });
  const [e] = await api.getEntries();
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
  const [before] = await api.getEntries();
  const r = await api.applyFix({ locationId: before.locationId }, 'https://www.imdb.com/title/tt1877830/');
  assert.equal(r.ok, true);
  assert.equal((await api.getEntries())[0].title, 'The Batman');
});

test('applyFix without a key reports bad_key and sends no request', async () => {
  const { api, media, fetchCalls } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'x'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.scan();
  const [e] = await api.getEntries();
  assert.deepEqual(await api.applyFix({ locationId: e.locationId }, 'tt1877830'), { ok: false, error: 'bad_key' });
  assert.equal(fetchCalls.length, 0);
});

test('removeRoot drops the root, its folders and titles left without a folder', async () => {
  const { api, media } = setup();
  fs.mkdirSync(path.join(media, 'Movies', 'batman 2022'), { recursive: true });
  fs.mkdirSync(path.join(media, 'Anime', 'naruto'), { recursive: true });
  await api.addRoot(path.join(media, 'Movies'));
  await api.addRoot(path.join(media, 'Anime'));
  await api.scan();
  await api.setSettings({ omdbKey: 'K' });
  await api.startQueue(() => {});
  assert.equal((await api.getEntries()).length, 2);
  const movies = (await api.getRoots()).find((r) => r.relPath === 'Movies');
  await api.removeRoot(movies.id);
  const left = await api.getEntries();
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
