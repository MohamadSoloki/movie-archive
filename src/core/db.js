'use strict';
const { DatabaseSync } = require('node:sqlite');

const DEFAULTS = {
  copySpeeds: {}, // bytes per second of the last copy, per destination drive (internal: used to guess the time of the next one)
  patterns: ['{title} {year}*'],
  ignore: [],
  collections: [],
  language: 'fa',
  omdbKey: '',
  translateEmail: '',
  autoTranslate: true,
  priceEpisode: 0,
  priceMovie: 0,
  priceSeason: 0,
  shopName: '',
  phoneCatalog: false,
  catalogPort: 8787,
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
-- other names of a film (mostly Persian ones) so it can be found by them; they belong to the folder like tags do
CREATE TABLE IF NOT EXISTS aliases(location_id INTEGER NOT NULL, alias TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY(location_id, alias));
-- what was handed to a customer: one order per copy, with the titles in it (ref = imdb id, mal:<id> or n:<name>|<year>)
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, customer TEXT NOT NULL DEFAULT '', customer_key TEXT NOT NULL DEFAULT '', phone TEXT, note TEXT,
  created INTEGER NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, price INTEGER);
CREATE TABLE IF NOT EXISTS order_items(order_id INTEGER NOT NULL, ref TEXT NOT NULL, title TEXT NOT NULL, year TEXT, kind TEXT, detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id);
-- films customers asked for; key is the normalised name, so spellings of one name count together
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL DEFAULT 1, last INTEGER NOT NULL);
-- dub / sub set by hand on a folder: value 1 = it has it, 0 = it does not; no row = what the folder name says
CREATE TABLE IF NOT EXISTS quality_marks(location_id INTEGER NOT NULL, flag TEXT NOT NULL CHECK (flag IN ('dub', 'sub')), value INTEGER NOT NULL, PRIMARY KEY(location_id, flag));
-- lists customers sent from the phone catalog: items is a JSON array of { key, title, year }
CREATE TABLE IF NOT EXISTS wishes(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, note TEXT, created INTEGER NOT NULL, items TEXT NOT NULL);
-- series calendar: one row per show; due is the next air time (epoch ms, local clock), moved a week on each tick
CREATE TABLE IF NOT EXISTS reminders(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, key TEXT UNIQUE, weekday INTEGER NOT NULL, time TEXT NOT NULL,
  episode INTEGER, due INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
-- copies the app made (name = destination folder name); the hash is of the source bytes read at copy time, null when unknown
CREATE TABLE IF NOT EXISTS copies(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, target TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, checked INTEGER, state TEXT);
CREATE TABLE IF NOT EXISTS copy_files(
  copy_id INTEGER NOT NULL, rel TEXT NOT NULL, size INTEGER NOT NULL, sha TEXT, title TEXT, drive_serial TEXT, src_rel TEXT,
  PRIMARY KEY(copy_id, rel));
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
  // taken out of the archive view by the owner; the folder itself is never touched and a rescan keeps it hidden
  if (!db.prepare('PRAGMA table_info(locations)').all().some((c) => c.name === 'hidden')) {
    db.exec('ALTER TABLE locations ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
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
