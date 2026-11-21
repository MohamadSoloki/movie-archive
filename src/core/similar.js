'use strict';

// "Similar films" from what the archive already knows (OMDb genre, director, actors, country, year) and the person's own tags.
// No network, no model: the score is a few explainable points, and every point comes with a reason the page can show.
const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);
const yearOf = (y) => { const m = /\d{4}/.exec(y || ''); return m ? Number(m[0]) : null; };

// what the two sides share, in the casing of the film the person picked
function shared(mine, theirs) {
  const have = new Set(theirs.map((x) => x.toLowerCase()));
  return mine.filter((x) => have.has(x.toLowerCase()));
}

function similarTo(base, entries, { limit = 12 } = {}) {
  const mine = {
    genre: base.genreList || [], director: list(base.director), actor: list(base.actors),
    country: base.countryList || [], tag: base.userTags || [],
  };
  const baseYear = yearOf(base.year);
  const out = [];
  for (const e of entries) {
    if (e.key === base.key || e.status !== 'matched' || e.kind !== base.kind) continue;
    const common = {
      genre: shared(mine.genre, e.genreList || []), director: shared(mine.director, list(e.director)),
      actor: shared(mine.actor, list(e.actors)), country: shared(mine.country, e.countryList || []),
      tag: shared(mine.tag, e.userTags || []),
    };
    // something real must be shared; a country or a close year alone is not similarity
    if (!common.genre.length && !common.director.length && !common.actor.length && !common.tag.length) continue;

    const union = new Set([...mine.genre, ...(e.genreList || [])].map((x) => x.toLowerCase())).size;
    let score = union ? (common.genre.length / union) * 4 : 0;
    if (common.director.length) score += 3;
    score += Math.min(common.actor.length * 2, 4);
    score += Math.min(common.tag.length * 1.5, 3);
    score += Math.min(common.country.length * 0.5, 1);
    const year = yearOf(e.year);
    if (baseYear && year) {
      const gap = Math.abs(baseYear - year);
      score += gap <= 3 ? 1 : gap <= 10 ? 0.5 : 0;
    }
    const reasons = Object.entries(common).filter(([, v]) => v.length).map(([type, values]) => ({ type, values }));
    out.push({ entry: e, key: e.key, title: e.title, score: Math.round(score * 100) / 100, reasons });
  }
  const rate = (r) => Number.parseFloat(r.entry.rating) || 0;
  out.sort((a, b) => b.score - a.score || rate(b) - rate(a) || a.title.localeCompare(b.title));
  return out.slice(0, limit);
}

module.exports = { similarTo };
