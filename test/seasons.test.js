'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { episodesIn, episodeFilter, parseEpisodes } = require('../src/core/seasons.js');
const { copyTree, treeSize } = require('../src/core/transfer.js');

function season() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-'));
  for (const n of ['Show.S02E01.mkv', 'Show.S02E01.srt', 'Show.S02E02.mkv', 'Show.S02E05.mkv', 'cover.jpg']) fs.writeFileSync(path.join(dir, n), 'x'.repeat(10));
  fs.mkdirSync(path.join(dir, 'E07'));
  fs.writeFileSync(path.join(dir, 'E07', 'video.mkv'), 'x'.repeat(10));
  return dir;
}

test('episodesIn lists the episode numbers a season folder holds, sorted, files in subfolders too', () => {
  assert.deepEqual(episodesIn(season()), [1, 2, 5, 7]);
  assert.equal(episodesIn(fs.mkdtempSync(path.join(os.tmpdir(), 'none-'))), null); // nothing readable: the whole season only
});

test('parseEpisodes reads "1-5, 7 9" and Persian digits; junk and huge numbers are dropped', () => {
  assert.deepEqual(parseEpisodes('1-5, 7 9'), [1, 2, 3, 4, 5, 7, 9]);
  assert.deepEqual(parseEpisodes('۲،۴'), [2, 4]);
  assert.deepEqual(parseEpisodes('5-3'), [3, 4, 5]);
  assert.deepEqual(parseEpisodes('x, 0, 99999, 2-2'), [2]);
});

test('copyTree and treeSize with an episode filter take only those episodes and their subtitles', async () => {
  const src = season();
  const only = episodeFilter([1, 7]);
  assert.equal(treeSize(src, only), 30);
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dst-')), 'S02');
  const r = await copyTree(src, dst, { filter: only });
  assert.deepEqual(r.files.map((f) => path.relative(dst, f.dest).split(path.sep).join('/')).sort(), ['E07/video.mkv', 'Show.S02E01.mkv', 'Show.S02E01.srt']);
  assert.equal(fs.existsSync(path.join(dst, 'Show.S02E02.mkv')), false);
});
