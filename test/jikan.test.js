'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createJikan } = require('../src/core/jikan.js');

const A = (over) => ({
  mal_id: 16498, title: 'Shingeki no Kyojin', title_english: 'Attack on Titan', year: 2013,
  synopsis: 'Humanity lives behind walls.', score: 8.57, duration: '24 min per ep',
  genres: [{ name: 'Action' }, { name: 'Drama' }], images: { jpg: { large_image_url: 'https://x/a.jpg' } }, ...over,
});
const resp = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }) });
const noSleep = async () => {};

test('maps the best Jikan hit to TitleInfo', async () => {
  const urls = [];
  const jikan = createJikan({ fetch: async (u) => { urls.push(String(u)); return resp([A()]); }, sleep: noSleep });
  const info = await jikan.searchAnime('attack on titan');
  assert.deepEqual(info, {
    source: 'jikan', imdbId: null, malId: 16498, title: 'Attack on Titan', year: '2013', type: 'anime',
    plot: 'Humanity lives behind walls.', genres: 'Action, Drama', rating: '8.57', runtime: '24 min per ep',
    actors: null, posterUrl: 'https://x/a.jpg', director: null, awards: null, rated: null, country: null, totalSeasons: null,
  });
  assert.match(urls[0], /q=attack%20on%20titan/);
});

test('prefers the result with the requested year', async () => {
  const jikan = createJikan({ fetch: async () => resp([A({ mal_id: 1, year: 2000 }), A({ mal_id: 2, year: 2013 })]), sleep: noSleep });
  assert.equal((await jikan.searchAnime('attack on titan', '2013')).malId, 2);
});

test('a hit whose names are nothing like the folder title is not taken (a film OMDb lacks must not become a random anime)', async () => {
  const jikan = createJikan({ fetch: async () => resp([A()]), sleep: noSleep });
  assert.equal(await jikan.searchAnime('Heat'), null);
  // any of its names counts: English, romaji, Japanese, synonyms
  assert.equal((await jikan.searchAnime('Shingeki no Kyojin')).malId, 16498);
  const syn = createJikan({ fetch: async () => resp([A({ title: 'Boku no Hero Academia', title_english: null, titles: [{ type: 'Synonym', title: 'My Hero Academia' }] })]), sleep: noSleep });
  assert.equal((await syn.searchAnime('my hero academia')).malId, 16498);
});

test('no results gives null', async () => {
  const jikan = createJikan({ fetch: async () => resp([]), sleep: noSleep });
  assert.equal(await jikan.searchAnime('zzz'), null);
});

test('429 is retried once after a pause', async () => {
  const answers = [resp(null, 429), resp([A()])];
  let calls = 0;
  const jikan = createJikan({ fetch: async () => { calls++; return answers.shift(); }, sleep: noSleep });
  assert.equal((await jikan.searchAnime('attack on titan')).malId, 16498);
  assert.equal(calls, 2);
});

test('Jikan allows about 60 requests a minute: a busy 429 is retried three times with longer pauses before it counts as network', async () => {
  const pauses = [];
  let calls = 0;
  const limited = createJikan({ fetch: async () => { calls++; return resp(null, 429); }, sleep: async (ms) => { pauses.push(ms); } });
  await assert.rejects(limited.searchAnime('x'), (e) => e.kind === 'network');
  assert.equal(calls, 4);
  assert.deepEqual(pauses, [1000, 2000, 3000]);
  const later = [resp(null, 429), resp(null, 429), resp([A()])];
  const ok = createJikan({ fetch: async () => later.shift(), sleep: noSleep });
  assert.equal((await ok.searchAnime('attack on titan')).malId, 16498);
});

test('thrown fetches map to network', async () => {
  const down = createJikan({ fetch: async () => { throw new Error('down'); }, sleep: noSleep });
  await assert.rejects(down.searchAnime('x'), (e) => e.kind === 'network');
});

const page = (data, hasNext) => ({ ok: true, status: 200, json: async () => ({ data, pagination: { has_next_page: hasNext } }) });

test('episodes follows the pages and maps score and aired date', async () => {
  const urls = [];
  const answers = [
    page([{ mal_id: 1, title: 'To You', aired: '2013-04-07T00:00:00+00:00', score: 4.3 }], true),
    page([{ mal_id: 2, title: 'That Day', aired: null, score: null }], false),
  ];
  const jikan = createJikan({ fetch: async (u) => { urls.push(String(u)); return answers.shift(); }, sleep: noSleep });
  assert.deepEqual(await jikan.episodes(16498), [
    { number: 1, name: 'To You', released: '2013-04-07', rating: '4.3' },
    { number: 2, name: 'That Day', released: null, rating: null },
  ]);
  assert.match(urls[0], /\/anime\/16498\/episodes\?page=1/);
  assert.match(urls[1], /page=2/);
});

test('episode returns the synopsis, and 404 gives null / []', async () => {
  const ok = createJikan({ fetch: async () => resp({ synopsis: 'Eren sees.' }), sleep: noSleep });
  assert.equal(await ok.episode(16498, 2), 'Eren sees.');
  const gone = createJikan({ fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), sleep: noSleep });
  assert.equal(await gone.episode(1, 99), null);
  assert.deepEqual(await gone.episodes(1), []);
});

test('minGap spaces requests that are started together; the default never waits', async () => {
  const sleeps = [];
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });
  const j = createJikan({ fetch: ok, sleep: async (ms) => { sleeps.push(ms); }, minGap: 400, now: () => 1000 });
  await Promise.all([j.searchAnime('a'), j.searchAnime('b'), j.searchAnime('c')]);
  assert.deepEqual(sleeps, [400, 800]);
  const none = [];
  const j2 = createJikan({ fetch: ok, sleep: async (ms) => { none.push(ms); } });
  await Promise.all([j2.searchAnime('a'), j2.searchAnime('b')]);
  assert.deepEqual(none, []);
});

const REC = (id, title, votes) => ({ entry: { mal_id: id, title, images: { jpg: { image_url: `https://x/${id}.jpg`, large_image_url: `https://x/${id}L.jpg` } } }, votes });

test('recommendations: what MyAnimeList users recommend, most votes first, capped', async () => {
  const urls = [];
  const jikan = createJikan({ fetch: async (u) => { urls.push(String(u)); return resp([REC(2, 'B', 5), REC(3, 'C', 50), REC(4, 'D', 20)]); }, sleep: noSleep });
  const r = await jikan.recommendations(16498, 2);
  assert.deepEqual(r, [
    { malId: 3, title: 'C', posterUrl: 'https://x/3L.jpg', votes: 50 },
    { malId: 4, title: 'D', posterUrl: 'https://x/4L.jpg', votes: 20 },
  ]);
  assert.match(urls[0], /\/anime\/16498\/recommendations$/);
});

test('recommendations: an unknown anime gives an empty list, a network failure is a ProviderError', async () => {
  assert.deepEqual(await createJikan({ fetch: async () => resp(null, 404), sleep: noSleep }).recommendations(1), []);
  await assert.rejects(createJikan({ fetch: async () => { throw new Error('offline'); }, sleep: noSleep }).recommendations(1), { kind: 'network' });
});
