'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickConfident } = require('../src/core/match.js');

const C = (title, year, type = 'movie') => ({ imdbId: `tt-${title}-${year}`, title, year, type, posterUrl: null });
const P = (title, year = null, season = null) => ({ title, year, season });

test('a series folder with a season picks the series, "The" is ignored', () => {
  const c = C('The Mentalist', '2008–2015', 'series');
  assert.equal(pickConfident(P('The Mentalist', '2008', '01'), [c]), c);
  assert.equal(pickConfident(P('Mentalist', null, '01'), [c]), c);
});

test('a season folder never picks a movie', () => {
  assert.equal(pickConfident(P('Mentalist', null, '01'), [C('Mentalist', '2008', 'movie')]), null);
});

test('without a season both movies and series qualify, episodes never do', () => {
  assert.ok(pickConfident(P('Friends', '1994'), [C('Friends', '1994–2004', 'series')]));
  assert.equal(pickConfident(P('Pilot'), [C('Pilot', '2008', 'episode')]), null);
});

test('no folder year and two matching titles is ambiguous', () => {
  assert.equal(pickConfident(P('Dune'), [C('Dune', '1984'), C('Dune', '2021')]), null);
});

test('the folder year decides, one year off is accepted, two years off is not', () => {
  const list = [C('Dune', '1984'), C('Dune', '2021')];
  assert.equal(pickConfident(P('Dune', '2021'), list).year, '2021');
  assert.equal(pickConfident(P('Dune', '2020'), list).year, '2021');
  assert.equal(pickConfident(P('Dune', '2019'), list), null);
});

test('a one-letter typo in a long title is accepted, a different short title is not', () => {
  assert.equal(pickConfident(P('Incepton', '2010'), [C('Inception', '2010')]).title, 'Inception');
  assert.equal(pickConfident(P('Up'), [C('Us', '2019')]), null);
});

test('candidates with missing fields never throw', () => {
  assert.equal(pickConfident(P('x'), [{ imdbId: 'tt1' }]), null);
  assert.equal(pickConfident(P(''), [C('', '2000')]), null);
});
