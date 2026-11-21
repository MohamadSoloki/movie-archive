'use strict';
const { DatabaseSync } = require('node:sqlite');

const DEFAULTS = {
  patterns: ['{title} {year}*'],
  ignore: [],
  collections: [],
  language: 'fa',
  omdbKey: '',
  translateEmail: '',
  autoTranslate: true,
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
CREATE TABLE IF NOT EXISTS episodes(
  title_id INTEGER NOT NULL, season INTEGER NOT NULL, number INTEGER NOT NULL, ext_id TEXT, name TEXT,
  released TEXT, rating TEXT, plot TEXT, PRIMARY KEY(title_id, season, number));
CREATE TABLE IF NOT EXISTS translations(hash TEXT PRIMARY KEY, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- tags the owner adds by hand; they belong to the folder, so they survive a rescan and an online fix
CREATE TABLE IF NOT EXISTS tags(location_id INTEGER NOT NULL, tag TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY(location_id, tag));
-- series calendar: one row per show; due is the next air time (epoch ms, local clock), moved a week on each tick
CREATE TABLE IF NOT EXISTS reminders(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, key TEXT UNIQUE, weekday INTEGER NOT NULL, time TEXT NOT NULL,
  episode INTEGER, due INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
`;

// the queue looks a film up by lower-cased name for every folder, and the detail view joins by title
const INDEXES = `
CREATE INDEX IF NOT EXISTS loc_twin ON locations(lower(parsed_title), parsed_year);
CREATE INDEX IF NOT EXISTS loc_title ON locations(title_id);
DROP INDEX IF EXISTS loc_status;
`;

// added after the first release, so databases that already exist get them too
const TITLE_COLUMNS = [['director', 'TEXT'], ['awards', 'TEXT'], ['rated', 'TEXT'], ['country', 'TEXT'], ['total_seasons', 'INTEGER']];

function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  // WAL + NORMAL: a commit no longer waits for the disk, which cost a lot on slow drives and antivirus-scanned folders
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -8000;');
  db.exec(SCHEMA);
  const have = db.prepare('PRAGMA table_info(titles)').all().map((c) => c.name);
  if (!have.includes('poster_url')) db.exec('ALTER TABLE titles ADD COLUMN poster_url TEXT');
  // a root added as one single folder (one title) instead of a folder of titles
  // the folder that groups this title with others (Batman Trilogy/...), as a relative path
  if (!db.prepare('PRAGMA table_info(locations)').all().some((c) => c.name === 'collection')) {
    db.exec('ALTER TABLE locations ADD COLUMN collection TEXT');
  }
  if (!db.prepare('PRAGMA table_info(roots)').all().some((c) => c.name === 'single')) {
    db.exec('ALTER TABLE roots ADD COLUMN single INTEGER NOT NULL DEFAULT 0');
  }
  for (const [name, type] of TITLE_COLUMNS) {
    if (!have.includes(name)) db.exec(`ALTER TABLE titles ADD COLUMN ${name} ${type}`);
  }
  db.exec(INDEXES);
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
