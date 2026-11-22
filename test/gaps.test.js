'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/core/db.js');
const { upsertTitle } = require('../src/core/titles.js');
const { episodeRefs, seriesGaps } = require('../src/core/gaps.js');

test('episode numbers are read from common file names', () => {
  assert.deepEqual(episodeRefs('Show.S01E05.1080p.mkv'), [{ season: 1, ep: 5 }]);
  assert.deepEqual(episodeRefs('show 1x07.mp4'), [{ season: 1, ep: 7 }]);
  assert.deepEqual(episodeRefs('Show E03.mkv'), [{ season: null, ep: 3 }]);
  assert.deepEqual(episodeRefs('Show Episode 04.mkv'), [{ season: null, ep: 4 }]);
  assert.deepEqual(episodeRefs('سریال قسمت ۰۵.mkv'), [{ season: null, ep: 5 }]);
  assert.deepEqual(episodeRefs('Show.S02E01E02.mkv'), [{ season: 2, ep: 1 }, { season: 2, ep: 2 }]);
  assert.deepEqual(episodeRefs('Show.S02E01-E03.mkv'), [{ season: 2, ep: 1 }, { season: 2, ep: 2 }, { season: 2, ep: 3 }]);
  assert.deepEqual(episodeRefs('Show.1080p.x265.mkv'), []);
});

function seed(files, { season = '1', online = 1 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaps-'));
  const dir = path.join(root, 'Series', 'Show S01');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  const db = openDb();
  db.prepare('INSERT INTO drives(serial, label, root, online) VALUES(?, ?, ?, ?)').run('S1', 'D', root, online);
  const id = upsertTitle(db, { source: 'omdb', imdbId: 'tt9', malId: null, title: 'Show', year: '2020', type: 'series', plot: 'p', genres: 'Drama', rating: '8', runtime: '40', actors: 'a', posterUrl: null }, null);
  db.prepare("INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, season, title_id, status) VALUES('S1', 'Series/Show S01', 'Show S01', 'Show', ?, ?, 'matched')").run(season, id);
  const ins = db.prepare('INSERT INTO episodes(title_id, season, number, released) VALUES(?, 1, ?, ?)');
  [1, 2, 3, 4].forEach((n) => ins.run(id, n, `2020-0${n}-01`));
  ins.run(id, 5, '2030-01-01'); // not aired yet: never counted as missing
  ins.run(id, 6, null);
  return { db, id };
}

test('a season with an aired episode missing is reported with the missing numbers', () => {
  const { db, id } = seed(['Show.S01E01.mkv', 'Show.S01E02.mkv', 'Show.S01E04.mkv']);
  const r = seriesGaps(db, { today: '2026-11-22' });
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].titleId, id);
  assert.deepEqual(r.entries[0].seasons, [{ season: 1, have: 3, expected: 4, missing: [3], locationId: 1 }]);
  assert.equal(r.checked, 1);
});

test('a complete season, an unnumbered folder and an offline drive report nothing', () => {
  assert.deepEqual(seriesGaps(seed(['e1.S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv', 'S01E04.mkv']).db, { today: '2026-11-22' }).entries, []);
  const unnumbered = seriesGaps(seed(['movie.mkv']).db, { today: '2026-11-22' });
  assert.deepEqual([unnumbered.entries, unnumbered.unreadable], [[], 1]);
  const off = seriesGaps(seed(['S01E01.mkv'], { online: 0 }).db, { today: '2026-11-22' });
  assert.deepEqual([off.entries, off.checked, off.offline], [[], 0, 1]);
});
