'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanFolder } = require('../src/core/scanner.js');

function tree(dirs, files = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), 'x');
  }
  return root;
}
const opts = { ignore: [], collections: [] };
const names = (scan) => scan.entries.map((e) => e.name).sort();

test('direct child folders are entries; files are not; empty flag set', () => {
  const root = tree(['A', 'Empty'], ['A/movie.mkv', 'loose.txt']);
  const scan = scanFolder(root, 'Movies', opts);
  assert.equal(scan.ok, true);
  assert.deepEqual(names(scan), ['A', 'Empty']);
  assert.equal(scan.entries.find((e) => e.name === 'Empty').isEmpty, true);
  assert.equal(scan.entries.find((e) => e.name === 'A').isEmpty, false);
  assert.equal(scan.entries.find((e) => e.name === 'A').relPath, 'Movies/A');
});

test('relPath has no leading slash when the root is the drive root', () => {
  const root = tree(['A']);
  assert.equal(scanFolder(root, '', opts).entries[0].relPath, 'A');
});

test('default and user ignore names are skipped, case-insensitively', () => {
  const root = tree(['$RECYCLE.BIN', 'System Volume Information', 'subtitles', 'Extras', 'Trash', 'Keep']);
  assert.deepEqual(names(scanFolder(root, '', { ...opts, ignore: ['trash'] })), ['Keep']);
});

test('collection folder is opened one level', () => {
  const root = tree(['Marvel/Iron Man', 'Marvel/Thor', 'Solo']);
  const scan = scanFolder(root, 'Movies', { ...opts, collections: ['Movies/Marvel'] });
  assert.deepEqual(names(scan), ['Iron Man', 'Solo', 'Thor']);
  assert.equal(scan.entries.find((e) => e.name === 'Thor').relPath, 'Movies/Marvel/Thor');
});

test('a root that cannot be read gives ok false and no entries', () => {
  const scan = scanFolder('/definitely/not/here', 'x', opts);
  assert.equal(scan.ok, false);
  assert.deepEqual(scan.entries, []);
});

test('an unreadable child folder is skipped and the scan still succeeds', () => {
  const root = tree(['Good', 'Locked']);
  const fsApi = {
    ...fs,
    readdirSync(p, o) {
      if (String(p).endsWith('Locked')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return fs.readdirSync(p, o);
    },
  };
  const scan = scanFolder(root, '', { ...opts, fsApi });
  assert.equal(scan.ok, true);
  assert.deepEqual(names(scan), ['Good']);
  assert.deepEqual(scan.unreadable, ['Locked']);
});

test('an unreadable collection folder is reported as unreadable', () => {
  const root = tree(['Marvel/Thor', 'Solo']);
  const fsApi = {
    ...fs,
    readdirSync(p, o) {
      if (String(p).endsWith('Marvel')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return fs.readdirSync(p, o);
    },
  };
  const scan = scanFolder(root, 'Movies', { ...opts, collections: ['Movies/Marvel'], fsApi });
  assert.deepEqual(names(scan), ['Solo']);
  assert.deepEqual(scan.unreadable, ['Movies/Marvel']);
});

test('a clean scan has an empty unreadable list', () => {
  assert.deepEqual(scanFolder(tree(['A']), '', opts).unreadable, []);
});

const byRel = (scan) => Object.fromEntries(scan.entries.map((e) => [e.relPath, e]));
const pick = (e) => ({ season: e.season, titleName: e.titleName });

test('a series folder with named season folders gives one season entry each', () => {
  const root = tree(['Mentalist/Mentalist S01', 'Mentalist/Mentalist S02']);
  const m = byRel(scanFolder(root, '', opts));
  assert.deepEqual(Object.keys(m).sort(), ['Mentalist/Mentalist S01', 'Mentalist/Mentalist S02']);
  assert.deepEqual(pick(m['Mentalist/Mentalist S01']), { season: '01', titleName: 'Mentalist' });
  assert.deepEqual(pick(m['Mentalist/Mentalist S02']), { season: '02', titleName: 'Mentalist' });
});

test('season folders named Season N take the parent folder name', () => {
  const m = byRel(scanFolder(tree(['Mentalist/Season 1', 'Mentalist/Season 2']), '', opts));
  assert.deepEqual(pick(m['Mentalist/Season 1']), { season: '1', titleName: 'Mentalist' });
  assert.deepEqual(pick(m['Mentalist/Season 2']), { season: '2', titleName: 'Mentalist' });
});

test('the parent name keeps its year for the parser', () => {
  const m = byRel(scanFolder(tree(['The Mentalist (2008)/S01']), '', opts));
  assert.equal(m['The Mentalist (2008)/S01'].titleName, 'The Mentalist (2008)');
});

test('a dotted release season folder at the root', () => {
  const m = byRel(scanFolder(tree(['mentalist.s01.1080p.bluray']), '', opts));
  assert.deepEqual(pick(m['mentalist.s01.1080p.bluray']), { season: '01', titleName: 'mentalist' });
});

test('S1mone and Se7en are titles, not seasons', () => {
  const m = byRel(scanFolder(tree(['S1mone (2002)', 'Se7en']), '', opts));
  assert.deepEqual(pick(m['S1mone (2002)']), { season: null, titleName: 'S1mone (2002)' });
  assert.deepEqual(pick(m.Se7en), { season: null, titleName: 'Se7en' });
});

test('a container with only subfolders and no year is opened', () => {
  const scan = scanFolder(tree(['Action/Alien', 'Action/Predator']), '', opts);
  assert.deepEqual(scan.entries.map((e) => e.relPath).sort(), ['Action/Alien', 'Action/Predator']);
});

test('a movie folder with CD1 and CD2 stays one title', () => {
  const scan = scanFolder(tree(['Movie (2010)/CD1', 'Movie (2010)/CD2']), '', opts);
  assert.deepEqual(scan.entries.map((e) => e.relPath), ['Movie (2010)']);
});

test('a folder with a video file and Subs is one title', () => {
  const scan = scanFolder(tree(['Inception/Subs'], ['Inception/inception.mkv']), '', opts);
  assert.deepEqual(scan.entries.map((e) => e.relPath), ['Inception']);
});

test('Specials is ignored next to season folders', () => {
  const scan = scanFolder(tree(['Show/Season 1', 'Show/Specials']), '', opts);
  assert.deepEqual(scan.entries.map((e) => [e.relPath, e.season]), [['Show/Season 1', '1']]);
});

test('the scan stops opening folders at depth 8', () => {
  const root = tree(['a/b/c/d/e/f/g/h/i/j/k']);
  const scan = scanFolder(root, '', opts);
  assert.deepEqual(scan.entries.map((e) => e.relPath), ['a/b/c/d/e/f/g/h']);
});

test('an unreadable season folder is listed as unreadable and the scan still succeeds', () => {
  const root = tree(['Show/Season 1', 'Show/Season 2']);
  const fsApi = {
    ...fs,
    readdirSync(p, o) {
      if (String(p).endsWith('Season 1')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return fs.readdirSync(p, o);
    },
  };
  const scan = scanFolder(root, '', { ...opts, fsApi });
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.unreadable, ['Show/Season 1']);
  assert.deepEqual(scan.entries.map((e) => e.relPath), ['Show/Season 2']);
});

test('a folder holding several seasons is the whole show, not season 1', () => {
  const root = tree(['Friends S01-S10', 'Dexter S1-S8 Complete', 'Lost/Seasons 1-5']);
  const m = Object.fromEntries(scanFolder(root, '', opts).entries.map((e) => [e.name, e]));
  assert.deepEqual([m['Friends S01-S10'].season, m['Friends S01-S10'].titleName], [null, 'Friends']);
  assert.deepEqual([m['Dexter S1-S8 Complete'].season, m['Dexter S1-S8 Complete'].titleName], [null, 'Dexter']);
  assert.deepEqual([m['Seasons 1-5'].season, m['Seasons 1-5'].titleName], [null, 'Lost']);
});

test('season folders inside a multi-season wrapper take the clean show name', () => {
  const root = tree(['Friends S01-S10/Season 1', 'Friends S01-S10/Season 2']);
  const e = scanFolder(root, '', opts).entries;
  assert.deepEqual(e.map((x) => [x.season, x.titleName]), [['1', 'Friends'], ['2', 'Friends']]);
});

test('only: scans just that one folder, case-insensitively, and classifies it like any other', () => {
  const root = tree(['Batman 2022', 'Other', 'Mentalist/Season 1', 'Mentalist/Season 2']);
  assert.deepEqual(names(scanFolder(root, 'Movies', { ...opts, only: 'batman 2022' })), ['Batman 2022']);
  const show = scanFolder(root, 'Movies', { ...opts, only: 'Mentalist' }).entries;
  assert.deepEqual(show.map((e) => [e.relPath, e.season, e.titleName]), [['Movies/Mentalist/Season 1', '1', 'Mentalist'], ['Movies/Mentalist/Season 2', '2', 'Mentalist']]);
  assert.deepEqual(scanFolder(root, 'Movies', { ...opts, only: 'nothing' }).entries, []);
});

const colOf = (scan) => Object.fromEntries(scan.entries.map((e) => [e.name, e.collection]));

test('a collection folder of movie folders: each movie is an entry that remembers the collection', () => {
  const scan = scanFolder(tree(['Batman Trilogy/Batman Begins (2005)', 'Batman Trilogy/The Dark Knight (2008)', 'Batman Trilogy/The Dark Knight Rises (2012)']), 'Movies', opts);
  assert.equal(scan.entries.length, 3);
  assert.ok(scan.entries.every((e) => e.collection === 'Movies/Batman Trilogy'));
  assert.deepEqual(colOf(scanFolder(tree(['Alien 1979']), '', opts)), { 'Alien 1979': null });
});

test('a collection whose own name has a year is still opened when it holds several movie folders', () => {
  const scan = scanFolder(tree(['Batman Trilogy (2005-2012)/Batman Begins (2005)', 'Batman Trilogy (2005-2012)/The Dark Knight (2008)']), '', opts);
  assert.deepEqual(scan.entries.map((e) => e.relPath).sort(), ['Batman Trilogy (2005-2012)/Batman Begins (2005)', 'Batman Trilogy (2005-2012)/The Dark Knight (2008)']);
});

test('a folder holding several movie files gives one entry per file, named after the file', () => {
  const files = ['Batman Trilogy/Batman.Begins.2005.1080p.mkv', 'Batman Trilogy/The.Dark.Knight.2008.1080p.mkv', 'Batman Trilogy/The.Dark.Knight.Rises.2012.mkv', 'Batman Trilogy/readme.txt'];
  const scan = scanFolder(tree(['Batman Trilogy'], files), '', opts);
  assert.deepEqual(scan.entries.map((e) => [e.name, e.relPath, e.collection, e.titleName]), [
    ['Batman.Begins.2005.1080p', 'Batman Trilogy/Batman.Begins.2005.1080p.mkv', 'Batman Trilogy', 'Batman.Begins.2005.1080p'],
    ['The.Dark.Knight.2008.1080p', 'Batman Trilogy/The.Dark.Knight.2008.1080p.mkv', 'Batman Trilogy', 'The.Dark.Knight.2008.1080p'],
    ['The.Dark.Knight.Rises.2012', 'Batman Trilogy/The.Dark.Knight.Rises.2012.mkv', 'Batman Trilogy', 'The.Dark.Knight.Rises.2012']]);
});

test('samples, trailers, episodes and disc parts are not separate movies', () => {
  const one = (files) => scanFolder(tree([], files), '', opts).entries.map((e) => e.relPath);
  assert.deepEqual(one(['Movie (2010)/movie.mkv', 'Movie (2010)/movie-sample.mkv', 'Movie (2010)/trailer.mp4']), ['Movie (2010)']);
  assert.deepEqual(one(['Show/Show.S01E01.mkv', 'Show/Show.S01E02.mkv']), ['Show']);
  assert.deepEqual(one(['Film/film.cd1.mkv', 'Film/film.cd2.mkv']), ['Film']);
  assert.deepEqual(one(['Film Name/film.part1.mkv', 'Film Name/film.part2.mkv']), ['Film Name']);
});

test('a movie folder with a year and two unrelated-year-less files stays one title', () => {
  assert.deepEqual(scanFolder(tree([], ['Inception (2010)/a.mkv', 'Inception (2010)/b.mkv']), '', opts).entries.map((e) => e.relPath), ['Inception (2010)']);
});

test('a series inside a collection keeps the collection; the series folder itself is not one', () => {
  const scan = scanFolder(tree(['Pack/Mentalist/Season 1', 'Pack/Mentalist/Season 2', 'Pack/Alien 1979']), '', opts);
  assert.deepEqual(scan.entries.map((e) => [e.relPath, e.collection]).sort(), [['Pack/Alien 1979', 'Pack'], ['Pack/Mentalist/Season 1', 'Pack'], ['Pack/Mentalist/Season 2', 'Pack']]);
});
