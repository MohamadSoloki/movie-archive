'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { similarTo } = require('../src/core/similar.js');

let n = 0;
const film = (title, o = {}) => ({
  key: `t:${++n}`, title, year: '2010', kind: 'movie', status: 'matched', rating: '7.0',
  genreList: [], director: null, actors: null, countryList: [], userTags: [], ...o,
});

const base = film('Base', { genreList: ['Action', 'Crime'], director: 'Christopher Nolan', actors: 'Christian Bale, Michael Caine', countryList: ['USA'], year: '2008' });

test('a film is never similar to itself, and unrelated films are left out', () => {
  const other = film('Romcom', { genreList: ['Romance', 'Comedy'], countryList: ['France'] });
  assert.deepEqual(similarTo(base, [base, other]), []);
});

test('shared genres make a film similar, more shared genres rank higher', () => {
  const one = film('One', { genreList: ['Action'] });
  const two = film('Two', { genreList: ['Action', 'Crime'] });
  assert.deepEqual(similarTo(base, [base, one, two]).map((r) => r.title), ['Two', 'One']);
});

test('the same director outranks a film that only shares a genre', () => {
  const genreOnly = film('GenreOnly', { genreList: ['Action', 'Crime'] });
  const sameDirector = film('SameDirector', { genreList: ['Action'], director: 'Christopher Nolan' });
  assert.equal(similarTo(base, [genreOnly, sameDirector])[0].title, 'SameDirector');
});

test('a shared actor alone is enough, and the match is not case sensitive', () => {
  const r = similarTo(base, [film('Actor', { actors: 'x y, MICHAEL CAINE' })]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].reasons.find((x) => x.type === 'actor').values, ['Michael Caine']);
});

test('reasons name what is shared', () => {
  const r = similarTo(base, [film('Twin', { genreList: ['Crime', 'Drama', 'Action'], director: 'Christopher Nolan', countryList: ['USA', 'UK'] })]);
  const by = Object.fromEntries(r[0].reasons.map((x) => [x.type, x.values]));
  assert.deepEqual(by.genre, ['Action', 'Crime']);
  assert.deepEqual(by.director, ['Christopher Nolan']);
  assert.deepEqual(by.country, ['USA']);
});

test('a series is only matched with series, a film with films', () => {
  const series = film('Show', { genreList: ['Action', 'Crime'], kind: 'series' });
  const movie = film('Movie', { genreList: ['Action', 'Crime'] });
  assert.deepEqual(similarTo(base, [series, movie]).map((r) => r.title), ['Movie']);
  const seriesBase = film('S', { genreList: ['Action'], kind: 'series' });
  assert.deepEqual(similarTo(seriesBase, [series, movie]).map((r) => r.title), ['Show']);
});

test('unmatched folders and collections are never suggested', () => {
  const guess = film('Unmatched', { genreList: ['Action', 'Crime'], status: 'pending' });
  const coll = film('Collection', { genreList: ['Action', 'Crime'], kind: 'collection' });
  assert.deepEqual(similarTo(base, [guess, coll]), []);
});

test('a film with nothing to compare has no similar films', () => {
  assert.deepEqual(similarTo(film('Bare'), [base, film('X', { genreList: ['Action'] })]), []);
});

test('the closer year and my own shared tags break ties', () => {
  const near = film('Near', { genreList: ['Action'], year: '2009' });
  const far = film('Far', { genreList: ['Action'], year: '1975' });
  assert.deepEqual(similarTo(base, [far, near]).map((r) => r.title), ['Near', 'Far']);
  const tagged = film('Tagged', { genreList: ['Action'], year: '1975', userTags: ['Batman'] });
  assert.equal(similarTo({ ...base, userTags: ['batman'] }, [near, tagged])[0].title, 'Tagged');
});

test('a series year range counts by its first year; the list is capped and ordered the same way every time', () => {
  const show = film('Show', { genreList: ['Action'], year: '2009–2013' });
  assert.equal(similarTo(base, [show])[0].title, 'Show');
  const many = Array.from({ length: 30 }, (_, i) => film(`F${String(i).padStart(2, '0')}`, { genreList: ['Action'] }));
  const r = similarTo(base, many, { limit: 5 });
  assert.deepEqual(r.map((x) => x.title), ['F00', 'F01', 'F02', 'F03', 'F04']);
});
