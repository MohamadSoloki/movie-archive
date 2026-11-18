'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFolderName } = require('../src/core/pattern.js');

const NOW = new Date('2026-11-17');
const P = ['{title} {year}*'];
const parse = (name, patterns = P) => parseFolderName(name, patterns, NOW);

test('plain title and year', () => {
  assert.deepEqual(parse('batman 2022'), { title: 'batman', year: '2022', season: null, by: 'pattern' });
});

test('dotted release name keeps title words and ignores the tail', () => {
  const r = parse('The.Batman.2022.1080p.BluRay.x265');
  assert.equal(r.title, 'The Batman');
  assert.equal(r.year, '2022');
});

test('year inside the title: last valid year wins', () => {
  assert.equal(parse('2001 A Space Odyssey 1968').year, '1968');
  assert.equal(parse('2001 A Space Odyssey 1968').title, '2001 A Space Odyssey');
  assert.equal(parse('Blade Runner 2049 2017').title, 'Blade Runner 2049');
  assert.equal(parse('Blade Runner 2049 2017').year, '2017');
});

test('future year is not a year: whole name becomes the title (auto)', () => {
  const r = parse('Blade Runner 2049');
  assert.deepEqual([r.title, r.year, r.by], ['Blade Runner 2049', null, 'auto']);
});

test('a folder named only with a year-like number is the title', () => {
  const r = parse('1917');
  assert.deepEqual([r.title, r.year], ['1917', null]);
});

test('custom pattern with parentheses', () => {
  assert.equal(parse('Joker (2019) [1080p]', ['{title} ({year})*']).year, '2019');
  assert.equal(parse('Joker (2019) [1080p]', ['{title} ({year})*']).title, 'Joker');
});

test('season token', () => {
  const s = parse('Breaking Bad S02', ['{title} S{season}']);
  assert.deepEqual([s.title, s.season], ['Breaking Bad', '02']);
});

test('empty pattern list falls back to auto', () => {
  const r = parse('Dune.2021.2160p.WEB-DL', []);
  assert.equal(r.by, 'auto');
  assert.equal(r.title, 'Dune');
  assert.equal(r.year, '2021');
});

test('auto cuts at the first junk tag when there is no year', () => {
  assert.equal(parse('Some Movie 1080p BluRay').title, 'Some Movie');
});

test('persian title', () => {
  assert.equal(parse('بتمن 2022').title, 'بتمن');
});

test('parenthesised and bracketed years match the default pattern', () => {
  const a = parse('Batman (2022)');
  assert.deepEqual([a.title, a.year, a.by], ['Batman', '2022', 'pattern']);
  const b = parse('Blade Runner 2049 (2017)');
  assert.deepEqual([b.title, b.year], ['Blade Runner 2049', '2017']);
  const c = parse('Dune [2021] 1080p');
  assert.deepEqual([c.title, c.year], ['Dune', '2021']);
});

test('auto parsing strips a dangling opening bracket from the title', () => {
  const r = parse('Batman (2022)', ['{title} S{season}']);
  assert.deepEqual([r.title, r.year, r.by], ['Batman', '2022', 'auto']);
});

test('an invalid pattern is skipped instead of throwing', () => {
  assert.doesNotThrow(() => parse('x 2020', ['{title} {year} {year}']));
  assert.equal(parse('x 2020', ['{title}{title}', '{title} {year}']).year, '2020');
});

test('first matching pattern wins', () => {
  const r = parse('Show S01 2020', ['{title} S{season}*', '{title} {year}*']);
  assert.equal(r.title, 'Show');
  assert.equal(r.season, '01');
});
