'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { relatedTo, franchiseKey } = require('../src/core/related');

const e = (title, year, extra = {}) => ({ key: `k:${title}`, title, year: String(year), status: 'matched', kind: 'movie', ...extra });

test('franchiseKey drops sequel numbers, part words, subtitles and a leading article', () => {
  assert.equal(franchiseKey('The Terminator'), 'terminator');
  assert.equal(franchiseKey('Terminator 2: Judgment Day'), 'terminator');
  assert.equal(franchiseKey('Terminator 3 - Rise of the Machines'), 'terminator');
  assert.equal(franchiseKey('Rocky IV'), 'rocky');
  assert.equal(franchiseKey('Toy Story Part 2'), 'toy story');
  assert.equal(franchiseKey('Se7en'), 'se7en');
});

test('related films: the same series by name, oldest first, never the film itself', () => {
  const list = [e('The Terminator', 1984), e('Terminator 2: Judgment Day', 1991), e('Terminator Genisys', 2015),
    e('Titanic', 1997), e('Terminator 3: Rise of the Machines', 2003)];
  const out = relatedTo(list[1], list).map((r) => r.title);
  assert.deepEqual(out, ['The Terminator', 'Terminator 3: Rise of the Machines', 'Terminator Genisys']);
});

test('related films: a short one-word name does not pull in unrelated titles; films of other kinds or unmatched are skipped', () => {
  const list = [e('Up', 2009), e('Upgrade', 2018), e('Up in the Air', 2009), e('Alien', 1979), e('Aliens', 1986),
    e('Alien', 1979, { key: 'k:series', kind: 'series' }), e('Alien 3', 1992, { status: 'review' })];
  assert.deepEqual(relatedTo(list[0], list), []);
  assert.deepEqual(relatedTo(list[3], list).map((r) => r.key), ['k:Aliens']);
});

test('related films: a film that shares an owner collection folder counts as related, whatever its name', () => {
  const list = [e('Iron Man', 2008, { locations: [{ collection: 'Marvel' }] }), e('The Avengers', 2012, { locations: [{ collection: 'Marvel' }] }), e('Heat', 1995)];
  assert.deepEqual(relatedTo(list[0], list).map((r) => r.title), ['The Avengers']);
});

test('relatedMap: every film with its related keys, same answer as relatedTo, fast enough for a big archive', () => {
  const { relatedMap } = require('../src/core/related');
  const list = [e('The Terminator', 1984), e('Terminator 2: Judgment Day', 1991), e('Terminator Genisys', 2015), e('Titanic', 1997),
    e('Alien', 1979), e('Aliens', 1986), e('Up', 2009), e('Up in the Air', 2009)];
  const map = relatedMap(list);
  for (const x of list) assert.deepEqual((map.get(x.key) || []).map((r) => r.key), relatedTo(x, list).map((r) => r.key), x.title);
  const big = Array.from({ length: 6000 }, (_, i) => e(`Film number ${i} of the long archive`, 2000 + (i % 20)));
  const t0 = Date.now();
  relatedMap(big);
  assert.ok(Date.now() - t0 < 1500);
});
