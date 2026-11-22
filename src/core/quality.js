'use strict';

// What the folder name says about the copy: resolution, Persian dubbing, subtitles (glued or not).
// Only the name is read (the whole relative path, so "Dubbed/Batman 2022" counts too); no file is opened.
const RANK = { '480p': 1, '720p': 2, '1080p': 3, '4K': 4 };

// ي/ك to ی/ک, no half-space, no hamza sign, separators to spaces
const norm = (s) => String(s ?? '').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌ٔ]/g, '').replace(/[._\-/\\]+/g, ' ');

function qualityOf(name) {
  const n = norm(name);
  let res = null;
  if (/(?<![a-z0-9])(2160p|4k|uhd)(?![a-z0-9])/.test(n)) res = '4K';
  else if (/(?<![a-z0-9])1080p(?![a-z0-9])/.test(n)) res = '1080p';
  else if (/(?<![a-z0-9])720p(?![a-z0-9])/.test(n)) res = '720p';
  else if (/(?<![a-z0-9])480p(?![a-z0-9])/.test(n)) res = '480p';
  const dub = /(?<![a-z])(dubbed|dub)(?![a-z])/.test(n) || n.includes('دوبله') || n.includes('دو زبانه');
  const hardsub = /(?<![a-z])(hardsub|hard sub|hardcoded)(?![a-z])/.test(n) || n.includes('چسبیده') || n.includes('هاردساب');
  const sub = hardsub || /(?<![a-z])(subtitles?|subs?|softsub|soft sub)(?![a-z])/.test(n) || n.includes('زیرنویس') || n.includes('سافت ساب');
  return { res, dub, sub, hardsub };
}

// several folders of one title: the best resolution, and a flag when any folder has it
function mergeQuality(list) {
  const out = { res: null, dub: false, sub: false, hardsub: false };
  for (const q of list) {
    if (q.res && (!out.res || RANK[q.res] > RANK[out.res])) out.res = q.res;
    out.dub ||= q.dub; out.sub ||= q.sub; out.hardsub ||= q.hardsub;
  }
  return out;
}

module.exports = { qualityOf, mergeQuality };
