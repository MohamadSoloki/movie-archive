'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOmdb } = require('../src/core/omdb.js');

const OK = {
  Response: 'True', imdbID: 'tt1877830', Title: 'The Batman', Year: '2022', Type: 'movie',
  Plot: 'When a sadistic serial killer begins murdering key political figures in Gotham...',
  Genre: 'Action, Crime', imdbRating: '7.8', Runtime: '176 min', Actors: 'Robert Pattinson', Poster: 'https://x/p.jpg',
  Director: 'Matt Reeves', Awards: '3 wins', Rated: 'PG-13', Country: 'United States',
};

function fake(body, init = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const client = (body, init) => {
  const f = fake(body, init);
  return { omdb: createOmdb({ apiKey: 'K', fetch: f }), f };
};

test('byTitle maps an OMDb answer to TitleInfo and sends key, title, year', async () => {
  const { omdb, f } = client(OK);
  const info = await omdb.byTitle('batman', '2022');
  assert.deepEqual(info, {
    source: 'omdb', imdbId: 'tt1877830', malId: null, title: 'The Batman', year: '2022', type: 'movie',
    plot: OK.Plot, genres: 'Action, Crime', rating: '7.8', runtime: '176 min', actors: 'Robert Pattinson',
    posterUrl: 'https://x/p.jpg', director: 'Matt Reeves', awards: '3 wins', rated: 'PG-13', country: 'United States', totalSeasons: null,
  });
  const u = new URL(f.calls[0]);
  assert.equal(u.searchParams.get('apikey'), 'K');
  assert.equal(u.searchParams.get('t'), 'batman');
  assert.equal(u.searchParams.get('y'), '2022');
});

test('byTitle passes type for series and omits year when null', async () => {
  const { omdb, f } = client(OK);
  await omdb.byTitle('Breaking Bad', null, 'series');
  const u = new URL(f.calls[0]);
  assert.equal(u.searchParams.get('type'), 'series');
  assert.equal(u.searchParams.has('y'), false);
});

test('byId asks by imdb id', async () => {
  const { omdb, f } = client(OK);
  await omdb.byId('tt1877830');
  assert.equal(new URL(f.calls[0]).searchParams.get('i'), 'tt1877830');
});

test('N/A values become null', async () => {
  const { omdb } = client({ ...OK, Poster: 'N/A', Plot: 'N/A' });
  const info = await omdb.byId('tt1');
  assert.equal(info.posterUrl, null);
  assert.equal(info.plot, null);
});

test('error mapping: not found, quota, bad key', async () => {
  const kind = async (Error) => {
    try { await client({ Response: 'False', Error }).omdb.byTitle('x'); } catch (e) { return e.kind; }
    return 'no error';
  };
  assert.equal(await kind('Movie not found!'), 'not_found');
  assert.equal(await kind('Request limit reached!'), 'quota');
  assert.equal(await kind('Invalid API key!'), 'bad_key');
  assert.equal(await kind('No API key provided.'), 'bad_key');
});

test('network failure and non-2xx map to network', async () => {
  const down = createOmdb({ apiKey: 'K', fetch: async () => { throw new Error('down'); } });
  await assert.rejects(down.byId('tt1'), (e) => e.kind === 'network');
  const bad = client({}, { ok: false, status: 503 }).omdb;
  await assert.rejects(bad.byId('tt1'), (e) => e.kind === 'network');
});

test('search maps results to candidates', async () => {
  const body = { Response: 'True', Search: [
    { Title: 'Batman', Year: '1989', imdbID: 'tt0096895', Type: 'movie', Poster: 'N/A' },
    { Title: 'The Batman', Year: '2022', imdbID: 'tt1877830', Type: 'movie', Poster: 'https://x/p.jpg' }] };
  const c = await client(body).omdb.search('batman');
  assert.deepEqual(c[0], { imdbId: 'tt0096895', title: 'Batman', year: '1989', type: 'movie', posterUrl: null });
  assert.equal(c[1].posterUrl, 'https://x/p.jpg');
});

test('search with no results returns []', async () => {
  assert.deepEqual(await client({ Response: 'False', Error: 'Movie not found!' }).omdb.search('zzz'), []);
});

test('search retries without the year when the year filter finds nothing', async () => {
  const urls = [];
  const fetch = async (u) => {
    const p = new URL(u).searchParams;
    urls.push(p.has('y'));
    return { ok: true, status: 200, json: async () => (p.has('y')
      ? { Response: 'False', Error: 'Movie not found!' }
      : { Response: 'True', Search: [{ Title: 'Batman', Year: '1989', imdbID: 'tt0096895', Type: 'movie', Poster: 'N/A' }] }) };
  };
  const c = await createOmdb({ apiKey: 'K', fetch }).search('batman', '1990');
  assert.equal(c.length, 1);
  assert.deepEqual(urls, [true, false]);
});

test('search still throws on quota', async () => {
  await assert.rejects(client({ Response: 'False', Error: 'Request limit reached!' }).omdb.search('x'), (e) => e.kind === 'quota');
});

test('byId maps director, awards, rated, country and totalSeasons; N/A becomes null', async () => {
  const { omdb } = client({ ...OK, Awards: 'N/A', totalSeasons: '7' });
  const info = await omdb.byId('tt1');
  assert.deepEqual([info.director, info.awards, info.rated, info.country, info.totalSeasons],
    ['Matt Reeves', null, 'PG-13', 'United States', 7]);
});

test('season maps the episode list of one season', async () => {
  const body = { Response: 'True', Season: '1', totalSeasons: '7', Episodes: [
    { Title: 'Pilot', Released: '2008-09-23', Episode: '1', imdbRating: '8.3', imdbID: 'tt1' },
    { Title: 'Red Hair', Released: 'N/A', Episode: '2', imdbRating: 'N/A', imdbID: 'tt2' }] };
  const { omdb, f } = client(body);
  const s = await omdb.season('tt0758745', 1);
  const u = new URL(f.calls[0]);
  assert.deepEqual([u.searchParams.get('i'), u.searchParams.get('Season')], ['tt0758745', '1']);
  assert.deepEqual(s, { totalSeasons: 7, episodes: [
    { number: 1, name: 'Pilot', released: '2008-09-23', rating: '8.3', imdbId: 'tt1' },
    { number: 2, name: 'Red Hair', released: null, rating: null, imdbId: 'tt2' }] });
});

test('season not found maps to not_found', async () => {
  await assert.rejects(client({ Response: 'False', Error: 'Series or season not found!' }).omdb.season('tt1', 9), (e) => e.kind === 'not_found');
});
