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
    director: null, awards: null, rated: a.rating ?? null, country: null, totalSeasons: null,
  };
}

// minGap: least milliseconds between two requests (Jikan allows about 3 a second), even when callers run together
function createJikan({ fetch = globalThis.fetch, sleep = defaultSleep, minGap = 0, now = Date.now } = {}) {
  let nextAt = 0;
  async function throttle() {
    const t = now();
    const wait = Math.max(0, nextAt - t);
    nextAt = Math.max(nextAt, t) + minGap;
    if (wait) await sleep(wait);
  }

  async function get(url, canRetry = true) {
    await throttle();
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
    if (res.status === 404) return { data: null };
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
    async episodes(malId) {
      const out = [];
      for (let page = 1; page <= 20; page += 1) {
        const body = await get(`${BASE}/${malId}/episodes?page=${page}`);
        for (const e of body.data || []) {
          out.push({
            number: e.mal_id, name: e.title, released: e.aired ? String(e.aired).slice(0, 10) : null,
            rating: e.score != null ? String(e.score) : null,
          });
        }
        if (!body.pagination?.has_next_page) break;
      }
      return out;
    },
    async episode(malId, number) {
      const body = await get(`${BASE}/${malId}/episodes/${number}`);
      return body.data?.synopsis ?? null;
    },
  };
}

module.exports = { createJikan };
