'use strict';
const { DatabaseSync } = require('node:sqlite');

const DEFAULTS = {
  patterns: ['{title} {year}*'],
  ignore: [],
  collections: [],
  language: 'fa',
  omdbKey: '',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS drives(serial TEXT PRIMARY KEY, label TEXT, root TEXT, online INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS roots(
  id INTEGER PRIMARY KEY, drive_serial TEXT NOT NULL, rel_path TEXT NOT NULL,
  UNIQUE(drive_serial, rel_path));
CREATE TABLE IF NOT EXISTS titles(
  id INTEGER PRIMARY KEY, imdb_id TEXT UNIQUE, mal_id INTEGER UNIQUE, source TEXT,
  title TEXT, year TEXT, type TEXT, plot TEXT, genres TEXT, rating TEXT, runtime TEXT,
  actors TEXT, poster_file TEXT, poster_url TEXT);
CREATE TABLE IF NOT EXISTS locations(
  id INTEGER PRIMARY KEY, drive_serial TEXT NOT NULL, rel_path TEXT NOT NULL,
  folder_name TEXT NOT NULL, parsed_title TEXT, parsed_year TEXT, season TEXT,
  title_id INTEGER, status TEXT NOT NULL DEFAULT 'pending',
  pinned INTEGER NOT NULL DEFAULT 0, guessed INTEGER NOT NULL DEFAULT 0,
  is_empty INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0,
  UNIQUE(drive_serial, rel_path));
`;

function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  // databases created before poster_url existed
  if (!db.prepare('PRAGMA table_info(titles)').all().some((c) => c.name === 'poster_url')) {
    db.exec('ALTER TABLE titles ADD COLUMN poster_url TEXT');
  }
  return db;
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : DEFAULTS[key];
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

module.exports = { openDb, getSetting, setSetting, DEFAULTS };
