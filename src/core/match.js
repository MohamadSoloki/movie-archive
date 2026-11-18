'use strict';

// lowercase, no accents, letters and digits only, no leading "the"
function norm(s) {
  const n = String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
  return n.startsWith('the') && n.length > 3 ? n.slice(3) : n;
}

function edits(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The search hit that clearly is the folder's title, or null.
 * A hit qualifies when its type fits (a season folder needs a series; episodes never qualify), its start year
 * is within one year of the folder year, and its title is the same or within 15% edits.
 * Without a folder year, two or more qualifying hits are ambiguous (Dune 1984 and 2021).
 */
function pickConfident({ title, year, season }, candidates) {
  const t = norm(title || '');
  if (!t) return null;
  const hits = candidates.filter((c) => {
    const typeOk = season ? c.type === 'series' : c.type === 'movie' || c.type === 'series';
    const y = parseInt(c.year, 10);
    const yearOk = !year || Number.isNaN(y) || Math.abs(y - Number(year)) <= 1;
    const n = norm(c.title || '');
    return typeOk && yearOk && n && edits(n, t) <= Math.floor(t.length * 0.15);
  });
  if (!year && hits.length > 1) return null;
  return hits[0] ?? null;
}

module.exports = { pickConfident };
