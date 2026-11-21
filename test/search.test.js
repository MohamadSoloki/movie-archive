'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { upsertTitle } = require('../src/core/titles.js');
const { createSearch } = require('../src/core/search.js');

const info = (imdbId, title) => ({ source: 'omdb', imdbId, malId: null, title, year: '2022', type: 'movie', plot: 'p',
  genres: 'Action', rating: '7', runtime: '100 min', actors: 'Robert Pattinson', posterUrl: null });
let n = 0;
function addLoc(db, { titleId = null, folder, title = 'x' }) {
  n += 1;
  db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, title_id, status)
    VALUES('S1', ?, ?, ?, ?, ?)`).run(`Movies/${folder}${n}`, folder, title, titleId, titleId ? 'matched' : 'pending');
}
function seed() {
  const db = openDb();
  const bat = upsertTitle(db, info('tt1', 'The Batman'), null);
  addLoc(db, { titleId: bat, folder: 'بتمن 2022' });
  const alien = upsertTitle(db, { ...info('tt2', 'Alien'), actors: 'Sigourney Weaver', genres: 'Horror' }, null);
  addLoc(db, { titleId: alien, folder: 'alien 1979' });
  return db;
}

test('a typo still finds the title', () => {
  const s = createSearch(seed());
  assert.equal(s.query({ query: 'batmn' }).entries[0].title, 'The Batman');
});

test('a persian query finds an entry through its folder name', () => {
  const s = createSearch(seed());
  assert.equal(s.query({ query: 'بتمن' }).entries[0].title, 'The Batman');
});

test('actors are searchable', () => {
  const s = createSearch(seed());
  assert.equal(s.query({ query: 'Weaver' }).entries[0].title, 'Alien');
});

test('blank query returns everything and nonsense returns nothing', () => {
  const s = createSearch(seed());
  assert.equal(s.query({ query: '   ' }).entries.length, 2);
  assert.deepEqual(s.query({ query: 'qqqqqqqq' }).entries, []);
});

test('invalidate makes new data searchable', () => {
  const db = seed();
  const s = createSearch(db);
  assert.equal(s.query({ query: 'matrix' }).entries.length, 0);
  const t = upsertTitle(db, info('tt3', 'The Matrix'), null);
  addLoc(db, { titleId: t, folder: 'the matrix 1999' });
  s.invalidate();
  assert.equal(s.query({ query: 'matrix' }).entries[0].title, 'The Matrix');
});

function library() {
  const db = openDb();
  const add = (imdbId, over, folder, season = null) => {
    const t = upsertTitle(db, { ...info(imdbId, over.title), ...over }, null);
    n += 1;
    db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, title_id, status, season)
      VALUES('S1', ?, ?, 'x', ?, 'matched', ?)`).run(`Lib/${folder}${n}`, folder, t, season);
  };
  add('tt1', { title: 'Scream', genres: 'Horror, Comedy', year: '1996', rating: '7.4' }, 'scream');
  add('tt2', { title: 'Alien', genres: 'Horror, Sci-Fi', year: '1979', rating: '8.5' }, 'alien');
  add('tt3', { title: 'airplane', genres: 'Comedy', year: '1980', rating: null }, 'airplane');
  add('tt4', { title: 'Dexter', genres: 'Crime, Horror', type: 'series', year: '2006', rating: '8.6' }, 'dexter', '01');
  return createSearch(db);
}
const names = (r) => r.entries.map((e) => e.title);

test('tab series keeps only series; tab movie only movies', () => {
  const s = library();
  assert.deepEqual(names(s.query({ tab: 'series' })), ['Dexter']);
  assert.deepEqual(names(s.query({ tab: 'movie' })).sort(), ['Alien', 'airplane', 'Scream'].sort());
});

test('all selected genres are required, case-insensitively', () => {
  const s = library();
  assert.deepEqual(names(s.query({ genres: ['horror', 'Comedy'] })), ['Scream']);
});

test('genre counts follow the tab and the text, not the genre filter', () => {
  const s = library();
  const r = s.query({ tab: 'movie', genres: ['Sci-Fi'] });
  assert.deepEqual(names(r), ['Alien']);
  assert.deepEqual(r.genres, [{ name: 'Comedy', count: 2 }, { name: 'Horror', count: 2 }, { name: 'Sci-Fi', count: 1 }]);
  assert.deepEqual(s.query({ query: 'dexter' }).genres.map((g) => g.name), ['Crime', 'Horror']);
});

test('sorting: name ignores case, year newest first, rating highest first with missing last, added newest first', () => {
  const s = library();
  assert.deepEqual(names(s.query({})), ['airplane', 'Alien', 'Dexter', 'Scream']);
  assert.deepEqual(names(s.query({ sort: 'year' })), ['Dexter', 'Scream', 'airplane', 'Alien']);
  assert.deepEqual(names(s.query({ sort: 'rating' })), ['Dexter', 'Alien', 'Scream', 'airplane']);
  assert.deepEqual(names(s.query({ sort: 'added' })), ['Dexter', 'airplane', 'Alien', 'Scream']);
});

test('attention filter keeps the chosen states and counts every state for the current tab, text and genres', () => {
  const db = openDb();
  const add = (id, title, guessed, status = 'matched', genres = 'Horror') => {
    // an unmatched location (review) has no title; a matched one does
    const tid = status === 'matched' ? upsertTitle(db, { ...info(id, title), genres }, null) : null;
    n += 1;
    db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, title_id, status, guessed)
      VALUES('S1', ?, ?, ?, ?, ?, ?)`).run(`P/${title}${n}`, title, title, tid, status, guessed);
  };
  add('tt31', 'Okay', 0); add('tt32', 'Guessy', 1); add('tt33', 'Broken', 0, 'review'); add('tt34', 'Comic', 0, 'matched', 'Comedy');
  const s = createSearch(db);
  const r = s.query({ attention: ['guess', 'problem'] });
  assert.deepEqual(r.entries.map((e) => e.title).sort(), ['Broken', 'Guessy']);
  assert.deepEqual(r.attentionCounts, { ok: 2, guess: 1, problem: 1 });
  const h = s.query({ genres: ['Horror'] });
  assert.deepEqual(h.attentionCounts, { ok: 1, guess: 1, problem: 0 }); // the unmatched one has no genre
  // genre counts follow the attention filter
  assert.deepEqual(s.query({ attention: ['ok'] }).genres, [{ name: 'Comedy', count: 1 }, { name: 'Horror', count: 1 }]);
});

function seedTags() {
  const db = seed();
  const ids = db.prepare('SELECT id FROM locations ORDER BY id').all().map((r) => r.id);
  db.prepare("INSERT INTO tags(location_id, tag) VALUES(?, 'Iranian')").run(ids[0]);
  db.prepare("INSERT INTO tags(location_id, tag) VALUES(?, 'Classic')").run(ids[0]);
  db.prepare("INSERT INTO tags(location_id, tag) VALUES(?, 'Classic')").run(ids[1]);
  return db;
}

test('the tags filter needs every chosen tag, ignoring case', () => {
  const s = createSearch(seedTags());
  assert.deepEqual(s.query({ tags: ['classic'] }).entries.map((e) => e.title).sort(), ['Alien', 'The Batman']);
  assert.deepEqual(s.query({ tags: ['CLASSIC', 'iranian'] }).entries.map((e) => e.title), ['The Batman']);
  assert.deepEqual(s.query({ tags: ['nothing'] }).entries, []);
});

test('tag counts follow the other filters, not the tag filter itself', () => {
  const s = createSearch(seedTags());
  const names = (r) => Object.fromEntries(r.tagCounts.map((c) => [c.name, c.count]));
  assert.deepEqual(names(s.query({})), { Classic: 2, Iranian: 1 });
  assert.deepEqual(names(s.query({ tags: ['Iranian'] })), { Classic: 2, Iranian: 1 });
  assert.deepEqual(names(s.query({ genres: ['Horror'] })), { Classic: 1 });
  // genre and status counts follow the chosen tags
  assert.deepEqual(s.query({ tags: ['Iranian'] }).genres.map((g) => g.name), ['Action']);
  assert.equal(s.query({ tags: ['Iranian'] }).attentionCounts.ok + s.query({ tags: ['Iranian'] }).attentionCounts.problem + s.query({ tags: ['Iranian'] }).attentionCounts.guess, 1);
});

test('a typed query also finds a tag, and tagList counts entries per tag', () => {
  const s = createSearch(seedTags());
  assert.deepEqual(s.query({ query: 'iranian' }).entries.map((e) => e.title), ['The Batman']);
  assert.deepEqual(s.tagList(), [{ name: 'Classic', count: 2 }, { name: 'Iranian', count: 1 }]);
});

function seedCountries() {
  const db = openDb();
  const add = (imdbId, title, country, genres) => {
    const t = upsertTitle(db, { ...info(imdbId, title), genres, country }, null);
    n += 1;
    db.prepare(`INSERT INTO locations(drive_serial, rel_path, folder_name, parsed_title, title_id, status)
      VALUES('S1', ?, ?, 'x', ?, 'matched')`).run(`C/${title}${n}`, title, t);
  };
  add('tt1', 'A Separation', 'Iran', 'Drama');
  add('tt2', 'Taxi', 'Iran, France', 'Comedy');
  add('tt3', 'Alien', 'United States, United Kingdom', 'Horror');
  add('tt4', 'Amelie', 'France', 'Comedy');
  return createSearch(db);
}

test('the country filter keeps films from any chosen country, ignoring case', () => {
  const s = seedCountries();
  assert.deepEqual(names(s.query({ countries: ['iran'] })).sort(), ['A Separation', 'Taxi']);
  assert.deepEqual(names(s.query({ countries: ['IRAN', 'united states'] })).sort(), ['A Separation', 'Alien', 'Taxi']);
  assert.deepEqual(s.query({ countries: ['Mars'] }).entries, []);
});

test('country counts follow the other filters but not the country filter; other counts follow the country filter', () => {
  const s = seedCountries();
  const all = s.query({ countries: ['Iran'], genres: ['Comedy'] });
  assert.deepEqual(all.countryCounts, [{ name: 'France', count: 2 }, { name: 'Iran', count: 1 }]);
  assert.deepEqual(s.query({ countries: ['Iran'] }).genres.map((g) => g.name).sort(), ['Comedy', 'Drama']);
  assert.deepEqual(s.query({ countries: ['Iran'] }).attentionCounts, { ok: 2, guess: 0, problem: 0 });
});

test('a typed query finds a film by its country', () => {
  const s = seedCountries();
  assert.deepEqual(names(s.query({ query: 'France' })).sort(), ['Amelie', 'Taxi']);
});
