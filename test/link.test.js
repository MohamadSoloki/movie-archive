'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractImdbId } = require('../src/core/link.js');

test('imdb title link', () => {
  assert.equal(extractImdbId('https://www.imdb.com/title/tt1877830/?ref_=x'), 'tt1877830');
});

test('omdb api link with a key', () => {
  assert.equal(extractImdbId('http://www.omdbapi.com/?i=tt1877830&apikey=ABC123'), 'tt1877830');
});

test('bare id and surrounding whitespace', () => {
  assert.equal(extractImdbId(' tt0111161 '), 'tt0111161');
});

test('no id returns null', () => {
  assert.equal(extractImdbId('https://example.com/nothing'), null);
  assert.equal(extractImdbId(''), null);
  assert.equal(extractImdbId('tt12'), null);
});
