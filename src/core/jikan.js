'use strict';
const { ProviderError } = require('./errors.js');

const BASE = 'https://api.jikan.moe/v4/anime';
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toInfo(a) {
  return {
    source: 'jikan', imdbId: null, malId: a.mal_id, title: a.title_english || a.title,
    year: a.year ? String(a.year) : null, type: 'anime', plot: a.synopsis ?? null,
    genres: (a.genres || []).map((g) => g.name).join(', ') || null,
    rating: a.score != null ? String(a.score) : null, runtime: a.duration ?? null, actors: null,
    posterUrl: a.images?.jpg?.large_image_url ?? null,
  };
}

function createJikan({ fetch = globalThis.fetch, sleep = defaultSleep } = {}) {
  async function get(url, canRetry = true) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new ProviderError('network', e.message);
    }
    if (res.status === 429) {
      if (!canRetry) throw new ProviderError('network', 'Jikan rate limit');
      await sleep(1000);
      return get(url, false);
    }
    if (!res.ok) throw new ProviderError('network', `HTTP ${res.status}`);
    return res.json();
  }

  return {
    async searchAnime(title, year = null) {
      const body = await get(`${BASE}?q=${encodeURIComponent(title)}&limit=5`);
      const list = body.data || [];
      const hit = (year && list.find((a) => String(a.year) === String(year))) || list[0];
      return hit ? toInfo(hit) : null;
    },
  };
}

module.exports = { createJikan };
