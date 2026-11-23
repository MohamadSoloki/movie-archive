'use strict';
const { ProviderError } = require('./errors.js');
const { sameName } = require('./match.js');

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

  // Jikan allows about 3 requests a second and 60 a minute: a busy answer waits 1 s, then 2 s, then 3 s before giving up
  async function get(url, retry = 0) {
    await throttle();
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new ProviderError('network', e.message);
    }
    if (res.status === 429) {
      if (retry >= 3) throw new ProviderError('network', 'Jikan rate limit');
      await sleep(1000 * (retry + 1));
      return get(url, retry + 1);
    }
    if (res.status === 404) return { data: null };
    if (!res.ok) throw new ProviderError('network', `HTTP ${res.status}`);
    return res.json();
  }

  return {
    async searchAnime(title, year = null) {
      const body = await get(`${BASE}?q=${encodeURIComponent(title)}&limit=5`);
      const list = body.data || [];
      // only a hit that carries the folder's name under one of its names; the first search result alone proves nothing
      const names = (a) => [a.title, a.title_english, a.title_japanese, ...(a.title_synonyms || []), ...(a.titles || []).map((x) => x.title)];
      const same = list.filter((a) => names(a).some((n) => sameName(title, n)));
      const hit = (year && same.find((a) => String(a.year) === String(year))) || same[0];
      return hit ? toInfo(hit) : null;
    },
    // Anime that MyAnimeList users recommend after this one, the most voted first
    async recommendations(malId, limit = 12) {
      const body = await get(`${BASE}/${malId}/recommendations`);
      return (body.data || [])
        .map((r) => ({ malId: r.entry.mal_id, title: r.entry.title, posterUrl: r.entry.images?.jpg?.large_image_url ?? r.entry.images?.jpg?.image_url ?? null, votes: r.votes ?? 0 }))
        .sort((a, b) => b.votes - a.votes)
        .slice(0, limit);
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
