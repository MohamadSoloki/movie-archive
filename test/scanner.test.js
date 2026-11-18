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
  for (const f of files) fs.writeFileSync(path.join(root, f), 'x');
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
