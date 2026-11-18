'use strict';
const { ProviderError } = require('./errors.js');

const BASE = 'https://www.omdbapi.com/';
const na = (v) => (v == null || v === 'N/A' ? null : v);

function errorFor(message = '') {
  if (/limit/i.test(message)) return new ProviderError('quota', message);
  if (/api key/i.test(message)) return new ProviderError('bad_key', message);
  return new ProviderError('not_found', message);
}

function toInfo(b) {
  return {
    source: 'omdb', imdbId: b.imdbID, malId: null, title: b.Title, year: na(b.Year), type: na(b.Type),
    plot: na(b.Plot), genres: na(b.Genre), rating: na(b.imdbRating), runtime: na(b.Runtime),
    actors: na(b.Actors), posterUrl: na(b.Poster),
  };
}

function createOmdb({ apiKey, fetch = globalThis.fetch }) {
  async function call(params) {
    const url = new URL(BASE);
    url.searchParams.set('apikey', apiKey);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new ProviderError('network', e.message);
    }
    // OMDb reports errors as JSON, sometimes with HTTP 401, so read the body before judging the status
    const body = await res.json().catch(() => null);
    if (body && body.Response === 'False') throw errorFor(body.Error);
    if (!res.ok || !body) throw new ProviderError('network', `HTTP ${res.status}`);
    return body;
  }

  async function search(title, year = null) {
    try {
      const body = await call({ s: title, y: year });
      return (body.Search || []).map((r) => ({
        imdbId: r.imdbID, title: r.Title, year: r.Year, type: r.Type, posterUrl: na(r.Poster),
      }));
    } catch (e) {
      if (e.kind !== 'not_found') throw e;
      // a folder year that is off by one would otherwise hide every candidate
      return year ? search(title, null) : [];
    }
  }

  return {
    async byTitle(title, year = null, type = null) {
      return toInfo(await call({ t: title, y: year, type, plot: 'full' }));
    },
    async byId(imdbId) {
      return toInfo(await call({ i: imdbId, plot: 'full' }));
    },
    search,
  };
}

module.exports = { createOmdb };
