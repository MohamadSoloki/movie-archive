'use strict';

const { relatedTo } = require('./related.js');
const { similarTo } = require('./similar.js');
const { readTranslation } = require('./translate.js');

const present = (value) => value && value !== 'N/A' ? value : null;

// Episode requests use both saved provider numbers and files recognized in an archived season.
function catalogDetail(db, entry, archiveSeasons, entries) {
  const seasons = new Map(archiveSeasons.map(({ season, episodes }) => [season, {
    season, episodes, selectable: true, knownEpisodes: 0, runtimeByEpisode: {},
  }]));
  const episodeChoices = new Map(archiveSeasons.map(({ season, episodes }) => [season, new Set(episodes ?? [])]));
  const ratings = new Map();
  const rows = db.prepare('SELECT season, number, rating, runtime FROM episodes WHERE title_id = ? ORDER BY season, number').all(entry.titleId ?? null);
  for (const row of rows) {
    if (!seasons.has(row.season)) {
      seasons.set(row.season, { season: row.season, episodes: null, selectable: false, knownEpisodes: 0, runtimeByEpisode: {} });
    }
    const season = seasons.get(row.season);
    season.knownEpisodes += 1;
    if (Number.isInteger(row.number) && row.number > 0 && row.number < 10000) episodeChoices.get(row.season)?.add(row.number);
    if (present(row.runtime) && (!season.episodes || season.episodes.includes(row.number))) {
      season.runtimeByEpisode[row.number] = row.runtime;
    }
    const rating = Number(row.rating);
    if (rating > 0 && rating <= 10) {
      const current = ratings.get(row.season) || { sum: 0, count: 0 };
      current.sum += rating;
      current.count += 1;
      ratings.set(row.season, current);
    }
  }
  const result = [...seasons.values()].sort((a, b) => a.season - b.season).map((season) => {
    const r = ratings.get(season.season);
    const choiceEpisodes = Array.from(episodeChoices.get(season.season) ?? []).sort((a, b) => a - b);
    return { ...season, choiceEpisodes, average: r ? Math.round(r.sum / r.count * 10) / 10 : null, ratedEpisodes: r?.count ?? 0 };
  });
  const awards = entry.awards;
  const related = relatedTo(entry, entries).map((e) => e.key);
  const excluded = new Set(related);
  return {
    plot: present(entry.plot) ? readTranslation(db, entry.plot) || entry.plot : null,
    actors: present(entry.actors),
    director: present(entry.director),
    runtime: present(entry.runtime),
    awards: /\bwon\s+(?!0\b)|\b[1-9]\d*\s+wins?\b/i.test(awards ?? '') ? awards : null,
    episodic: entry.kind === 'series' || result.length > 0,
    totalSeasons: entry.totalSeasons ?? null,
    availableSeasons: archiveSeasons.length,
    availableEpisodes: archiveSeasons.length && archiveSeasons.every((s) => s.episodes)
      ? archiveSeasons.reduce((sum, s) => sum + s.episodes.length, 0) : null,
    seasons: result,
    related: related.slice(0, 8),
    similar: similarTo(entry, entries.filter((e) => !excluded.has(e.key)), { limit: 6 }).map((r) => r.key),
  };
}

module.exports = { catalogDetail };
