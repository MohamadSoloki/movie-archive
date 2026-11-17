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
    actors: null, posterUrl: 'https://x/a.jpg',
  });
  assert.match(urls[0], /q=attack%20on%20titan/);
});

test('prefers the result with the requested year', async () => {
  const jikan = createJikan({ fetch: async () => resp([A({ mal_id: 1, year: 2000 }), A({ mal_id: 2, year: 2013 })]), sleep: noSleep });
  assert.equal((await jikan.searchAnime('x', '2013')).malId, 2);
});

test('no results gives null', async () => {
  const jikan = createJikan({ fetch: async () => resp([]), sleep: noSleep });
  assert.equal(await jikan.searchAnime('zzz'), null);
});

test('429 is retried once after a pause', async () => {
  const answers = [resp(null, 429), resp([A()])];
  let calls = 0;
  const jikan = createJikan({ fetch: async () => { calls++; return answers.shift(); }, sleep: noSleep });
  assert.equal((await jikan.searchAnime('x')).malId, 16498);
  assert.equal(calls, 2);
});

test('two 429s in a row and thrown fetches map to network', async () => {
  const limited = createJikan({ fetch: async () => resp(null, 429), sleep: noSleep });
  await assert.rejects(limited.searchAnime('x'), (e) => e.kind === 'network');
  const down = createJikan({ fetch: async () => { throw new Error('down'); }, sleep: noSleep });
  await assert.rejects(down.searchAnime('x'), (e) => e.kind === 'network');
});
