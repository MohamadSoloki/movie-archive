'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { qualityOf, mergeQuality } = require('../src/core/quality.js');

test('resolution from the folder name', () => {
  assert.equal(qualityOf('Batman.2022.1080p.BluRay.x265').res, '1080p');
  assert.equal(qualityOf('Dune 2021 720p').res, '720p');
  assert.equal(qualityOf('Movie 2160p HDR').res, '4K');
  assert.equal(qualityOf('Movie 2019 4K').res, '4K');
  assert.equal(qualityOf('Plain Name 2010').res, null);
});

test('a number inside a title is not a resolution', () => {
  assert.equal(qualityOf('Apollo 1080 2020').res, null);
  assert.equal(qualityOf('Room 720p2').res, null);
});

test('Persian dubbing in several spellings', () => {
  for (const n of ['بتمن 2022 دوبله فارسی', 'Batman 2022 Farsi Dubbed', 'Batman.2022.Dubbed', 'Batman 2022 Persian Dub', 'بتمن دوبله‌ی فارسی', 'بتمن 2022 دو زبانه']) {
    assert.equal(qualityOf(n).dub, true, n);
  }
  assert.equal(qualityOf('Batman 2022 1080p').dub, false);
  assert.equal(qualityOf('Dublin 2022').dub, false); // "dub" inside a word
});

test('subtitles, and hard-coded (glued) subtitles apart', () => {
  assert.deepEqual([qualityOf('Batman 2022 زیرنویس فارسی').sub, qualityOf('Batman 2022 زیرنویس فارسی').hardsub], [true, false]);
  assert.deepEqual([qualityOf('Batman 2022 زیرنویس چسبیده').sub, qualityOf('Batman 2022 زیرنویس چسبیده').hardsub], [true, true]);
  assert.equal(qualityOf('Batman 2022 HardSub').hardsub, true);
  assert.equal(qualityOf('Batman 2022 SoftSub').sub, true);
  assert.equal(qualityOf('Batman 2022 Subtitle').sub, true);
  assert.equal(qualityOf('Submarine 2010').sub, false); // "sub" inside a word
});

test('the arabic and persian letters ی/ي and ک/ك count the same', () => {
  assert.equal(qualityOf('بتمن دوبلهٔ فارسی').dub, true);
  assert.equal(qualityOf('زيرنويس چسبيده').hardsub, true);
});

test('mergeQuality: the best resolution and any flag over several folders', () => {
  const m = mergeQuality([qualityOf('A 720p'), qualityOf('A 1080p دوبله'), qualityOf('A زیرنویس')]);
  assert.deepEqual(m, { res: '1080p', dub: true, sub: true, hardsub: false });
  assert.deepEqual(mergeQuality([]), { res: null, dub: false, sub: false, hardsub: false });
});
