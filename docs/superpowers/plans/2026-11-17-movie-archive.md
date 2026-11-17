# Movie Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows Electron app that catalogs movies, series and anime from folders on several hard drives, identifies each title from its folder name, and fills in poster, plot and details from OMDb (Jikan for anime).

**Architecture:** All logic lives in plain CommonJS modules under `src/core/` that take their I/O (fetch, fs, PowerShell runner) as parameters, so every module is tested with `node --test` and fakes, no network. `src/api.js` wires the core modules into one object. `src/main.js` and `src/preload.js` only expose that object over IPC. The renderer is vanilla HTML/JS with a two-language dictionary.

**Tech Stack:** Electron 45, Node built-in `node:sqlite` and `node:test`, `fuse.js` (fuzzy search), `electron-builder` (NSIS installer). No framework, no bundler, no TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-17-movie-archive-design.md` (Persian)

## Global Constraints

- Platform: Windows desktop app on Electron. Source files are CommonJS (`"use strict"`).
- The app NEVER writes, renames, moves or deletes anything inside the user's media folders. Scanning is read-only.
- Metadata only from OMDb (`https://www.omdbapi.com/`) and, as anime fallback, Jikan (`https://api.jikan.moe/v4/anime`). No IMDb dataset, no scraping imdb.com, no embeddings or semantic API, no trailers, reviews or downloads, no video player.
- OMDb key comes only from the `omdbKey` setting. A key found inside a pasted OMDb link is ignored and never stored.
- Free OMDb quota is about 1000 requests per day. The queue stops when OMDb answers `Request limit reached!` and the location stays `pending`.
- Default folder pattern: `{title} {year}*`. Pattern tokens: `{title}`, `{year}`, `{season}`, `*`. Space, `.`, `-`, `_` are interchangeable separators. Matching is case-insensitive. First matching pattern wins.
- A direct child folder of a scanned root is one title. Subfolders are ignored for identification, except folders listed in the `collections` setting, which are opened one level.
- Default ignored folder names (case-insensitive): `$RECYCLE.BIN`, `System Volume Information`, `Subtitles`, `Subs`, `Extras`, `Sample`. Users can add more in the `ignore` setting.
- An empty folder is still a title in the archive, flagged `is_empty`.
- One title with many folders or drives is ONE entry with a list of locations. Season is stored per location.
- Folder keys are `(drive serial, path relative to the drive root, forward slashes)`, so a changed drive letter does not duplicate or lose anything.
- UI languages: Persian (`fa`, right-to-left) and English (`en`, left-to-right). Titles and plots from OMDb stay English in both.
- Posters are downloaded once into `<userData>/posters/` and shown from disk.
- Tests use fake `fetch`, fake `fs` or temp dirs. No test touches the network.
- Commit messages end with these two trailer lines (blank line before them):
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01A45qyYXJZxWk5AhzQZd7Sy`

## Review Focus

1. Year inside the title: `2001 A Space Odyssey 1968` is title `2001 A Space Odyssey`, year `1968`. `Blade Runner 2049` has no valid year (2049 is in the future), so the whole name is the title. A folder named just `1917` is title `1917`, no year. (Task 2)
2. OMDb answers HTTP 200 with `Response:"False"`. `Movie not found!` means not found and the pipeline moves on. `Request limit reached!` means quota: the queue stops and the location stays `pending`, never `review`. (Tasks 4, 5)
3. Internet drops mid-queue: the location stays `pending`, the queue stops with `network`, later locations are untouched. (Task 5)
4. Drive letter changes between sessions: same serial means same drive, no duplicate locations, nothing marked missing. (Task 3)
5. Unreadable folder (permission denied) or root that cannot be read: scan skips it and does not mark every location under it `missing`. (Task 3)

---

### Task 1: Project setup, database, settings

**Files:**
- Create: `package.json`, `.gitignore`, `src/core/db.js`, `test/db.test.js`

**Interfaces:**
- Produces: `openDb(file = ':memory:'): DatabaseSync` (applies schema, idempotent); `getSetting(db, key): any` (JSON-decoded, falls back to `DEFAULTS[key]`); `setSetting(db, key, value): void`; `DEFAULTS = { patterns: ['{title} {year}*'], ignore: [], collections: [], language: 'fa', omdbKey: '' }`.
- Schema (all created in `openDb`):
  - `settings(key TEXT PRIMARY KEY, value TEXT)`
  - `drives(serial TEXT PRIMARY KEY, label TEXT, root TEXT, online INTEGER DEFAULT 0)`
  - `roots(id INTEGER PRIMARY KEY, drive_serial TEXT NOT NULL, rel_path TEXT NOT NULL, UNIQUE(drive_serial, rel_path))`
  - `titles(id INTEGER PRIMARY KEY, imdb_id TEXT UNIQUE, mal_id INTEGER UNIQUE, source TEXT, title TEXT, year TEXT, type TEXT, plot TEXT, genres TEXT, rating TEXT, runtime TEXT, actors TEXT, poster_file TEXT)`
  - `locations(id INTEGER PRIMARY KEY, drive_serial TEXT NOT NULL, rel_path TEXT NOT NULL, folder_name TEXT NOT NULL, parsed_title TEXT, parsed_year TEXT, season TEXT, title_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', pinned INTEGER NOT NULL DEFAULT 0, guessed INTEGER NOT NULL DEFAULT 0, is_empty INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0, UNIQUE(drive_serial, rel_path))`. `status` is `pending`, `matched` or `review`.

- [ ] **Step 1: Write failing tests in `test/db.test.js`** (`node:test`, `node:assert/strict`)

```js
// openDb creates all tables
const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
for (const n of ['settings','drives','roots','titles','locations']) assert.ok(names.includes(n));
// default patterns
assert.deepEqual(getSetting(db, 'patterns'), ['{title} {year}*']);
// round trip
setSetting(db, 'ignore', ['Trash']); assert.deepEqual(getSetting(db, 'ignore'), ['Trash']);
// openDb twice on same file does not throw (idempotent schema)
```

- [ ] **Step 2: Run** `npm install --ignore-scripts && node --test` → FAIL (`Cannot find module '../src/core/db.js'`)
- [ ] **Step 3: Implement** `package.json` (`"main": "src/main.js"`, scripts `test: node --test`, `start: electron .`, `dist: electron-builder --win`; deps `fuse.js`; devDeps `electron@^45.3.3`, `electron-builder@^26.18.0`), `.gitignore` (`node_modules`, `dist`), and `src/core/db.js` using `require('node:sqlite').DatabaseSync` per Interfaces.
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `git add -A && git commit` message `feat: project setup, sqlite schema, settings`

### Task 2: Folder-name parser

**Files:**
- Create: `src/core/pattern.js`, `test/pattern.test.js`

**Interfaces:**
- Produces: `parseFolderName(name: string, patterns: string[], now = new Date()): { title: string, year: string|null, season: string|null, by: 'pattern'|'auto' }`.

Rules: normalize the name (replace runs of `.`, `_`, `-` with one space, collapse whitespace, trim) and the literal parts of each pattern the same way. Compile each pattern to an anchored case-insensitive regex: `{title}` → greedy `(?<title>.+)`, `{year}` → `(?<year>(?:18|19|20)\d{2})(?!\d)`, `{season}` → `(?<season>\d{1,2})(?!\d)`, `*` → `.*`, everything else escaped. A match counts only if `year` is between 1888 and `now.getFullYear()+1`; otherwise try the next pattern. No pattern matches → auto: take the LAST valid 4-digit year token (also inside parentheses) as the year and everything before it as title; no valid year → cut the name at the first junk tag (`1080p 720p 2160p 4k bluray brrip webrip web dl hdtv dvdrip x264 x265 h264 h265 hevc`, case-insensitive) and use the rest as title; if the title is empty, the title is the original normalized name and year is null. Title is trimmed with enclosing `()` and `[]` removed.

- [ ] **Step 1: Write failing tests** (fixed `now = new Date('2026-11-17')`)

```js
const P = ['{title} {year}*'];
assert.deepEqual(parseFolderName('batman 2022', P), { title:'batman', year:'2022', season:null, by:'pattern' });
assert.deepEqual(parseFolderName('The.Batman.2022.1080p.BluRay.x265', P).title, 'The Batman');
assert.equal(parseFolderName('2001 A Space Odyssey 1968', P).year, '1968');
assert.equal(parseFolderName('2001 A Space Odyssey 1968', P).title, '2001 A Space Odyssey');
assert.equal(parseFolderName('Blade Runner 2049 2017', P).title, 'Blade Runner 2049');
const br = parseFolderName('Blade Runner 2049', P);
assert.deepEqual([br.title, br.year, br.by], ['Blade Runner 2049', null, 'auto']);
const y = parseFolderName('1917', P); assert.deepEqual([y.title, y.year], ['1917', null]);
assert.equal(parseFolderName('Joker (2019) [1080p]', ['{title} ({year})*']).year, '2019');
const s = parseFolderName('Breaking Bad S02', ['{title} S{season}']);
assert.deepEqual([s.title, s.season], ['Breaking Bad', '02']);
assert.equal(parseFolderName('Dune.2021.2160p.WEB-DL', []).by, 'auto');   // empty patterns → auto
assert.equal(parseFolderName('Some Movie 1080p BluRay', P).title, 'Some Movie');
assert.equal(parseFolderName('بتمن 2022', P).title, 'بتمن');
```

- [ ] **Step 2: Run** `node --test test/pattern.test.js` → FAIL
- [ ] **Step 3: Implement** `parseFolderName` in `src/core/pattern.js` per the rules above.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat: folder name pattern parser`

### Task 3: Drives, scanner, library sync

**Files:**
- Create: `src/core/drives.js`, `src/core/scanner.js`, `src/core/sync.js`, `test/drives.test.js`, `test/scanner.test.js`, `test/sync.test.js`

**Interfaces:**
- Consumes: `openDb`, `getSetting`, `parseFolderName`.
- Produces:
  - `listDrives(run = defaultRun): Promise<Drive[]>` where `Drive = { serial: string, label: string, root: string }`. `defaultRun()` executes PowerShell `Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,VolumeSerialNumber | ConvertTo-Json` and resolves with its stdout. `root` is `DeviceID + '\\'`. Entries without a serial are skipped. PowerShell returns a bare object, not an array, when there is one drive.
  - `refreshDrives(db, drives: Drive[]): void` upserts drives (label, root), sets `online=1` for the given serials and `online=0` for all others.
  - `toDriveRel(drives: Drive[], absPath: string): { serial: string, relPath: string } | null` finds the drive whose root is a case-insensitive prefix of `absPath`; `relPath` uses `/` and has no leading or trailing slash (empty string for the drive root itself).
  - `scanFolder(absPath: string, relPath: string, opts: { ignore: string[], collections: string[], fsApi?: typeof import('node:fs') }): { ok: boolean, entries: { name: string, relPath: string, isEmpty: boolean }[] }`. Each direct child directory is an entry unless ignored (defaults from Global Constraints plus `opts.ignore`). A child whose `relPath` is in `opts.collections` is replaced by its own child directories (one level). A directory that cannot be read is skipped; if `absPath` itself cannot be read, `ok` is false and `entries` is empty.
  - `syncScan(db, args: { driveSerial: string, rootRel: string, scan: ReturnType<typeof scanFolder>, patterns: string[] }): void`.

`syncScan` behavior: do nothing if `scan.ok` is false. Upsert one `locations` row per entry (`folder_name`, `is_empty`, `missing=0`); on insert parse the name and store `parsed_title`, `parsed_year`, `season`, `guessed = (by === 'auto')`. On rescan, re-parse only rows that are not `pinned` and whose status is `pending` or `review`. Every existing location of that drive whose `rel_path` is under `rootRel` and was not in the scan gets `missing=1`.

- [ ] **Step 1: Write failing tests**

```js
// drives.test.js
const one = '{"DeviceID":"E:","VolumeName":"Films1","VolumeSerialNumber":"A1B2C3D4"}';
assert.deepEqual(await listDrives(async () => one), [{ serial:'A1B2C3D4', label:'Films1', root:'E:\\' }]);
assert.equal((await listDrives(async () => '[{"DeviceID":"C:","VolumeName":"","VolumeSerialNumber":null}]')).length, 0);
// refreshDrives marks absent drives offline
// toDriveRel
assert.deepEqual(toDriveRel([{serial:'S', label:'', root:'E:\\'}], 'e:\\Movies\\Action'), { serial:'S', relPath:'Movies/Action' });
assert.equal(toDriveRel([{serial:'S', label:'', root:'E:\\'}], 'F:\\x'), null);

// scanner.test.js (real temp dir)
// tree: A (has file), Empty (no entries), $RECYCLE.BIN, Subtitles, Marvel (collection) → [Iron Man, Thor]
assert.deepEqual(names(scan.entries).sort(), ['A','Empty','Iron Man','Thor']);
assert.equal(scan.entries.find(e => e.name === 'Empty').isEmpty, true);
assert.equal(scanFolder('/definitely/not/here', 'x', opts).ok, false);          // Review Focus 5
// fake fsApi whose readdirSync throws EACCES for one child → other entries still returned, ok true

// sync.test.js
// first scan inserts 'batman 2022' → parsed_title 'batman', parsed_year '2022', status 'pending', guessed 0
// second scan without that folder → missing = 1; scan with ok:false → no row changes (Review Focus 5)
// pinned matched location keeps title_id and parsed fields after rescan
// Review Focus 4: refreshDrives with same serial and new root 'G:\\' → still 1 drives row, locations unchanged, missing 0
```

- [ ] **Step 2: Run** `node --test` → FAIL
- [ ] **Step 3: Implement** the three modules per Interfaces. Use `fs.readdirSync(dir, { withFileTypes: true })` in `scanFolder` and `child_process.execFile('powershell.exe', ['-NoProfile','-Command', ...])` in `defaultRun`.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat: drive detection, folder scanner, library sync`

### Task 4: OMDb client and link parsing

**Files:**
- Create: `src/core/errors.js`, `src/core/omdb.js`, `src/core/link.js`, `test/omdb.test.js`, `test/link.test.js`

**Interfaces:**
- Produces:
  - `class ProviderError extends Error { kind: 'not_found'|'quota'|'bad_key'|'network' }` (in `errors.js`).
  - `TitleInfo = { source: 'omdb'|'jikan', imdbId: string|null, malId: number|null, title: string, year: string|null, type: string|null, plot: string|null, genres: string|null, rating: string|null, runtime: string|null, actors: string|null, posterUrl: string|null }`. OMDb value `"N/A"` becomes `null`.
  - `Candidate = { imdbId: string, title: string, year: string, type: string, posterUrl: string|null }`.
  - `createOmdb({ apiKey: string, fetch?: typeof fetch }): { byTitle(title: string, year?: string|null, type?: 'movie'|'series'|null): Promise<TitleInfo>, byId(imdbId: string): Promise<TitleInfo>, search(title: string, year?: string|null): Promise<Candidate[]> }`. Requests use `?apikey=&t=&y=&type=&plot=full` for `byTitle`, `?i=&plot=full` for `byId`, `?s=&y=` for `search`. `rating` is `imdbRating`.
  - `extractImdbId(link: string): string|null` returns the first match of `/\btt\d{7,10}\b/` or null.
- Error mapping: HTTP 200 with `Response:"False"` and `Error` containing `not found` → `not_found`; containing `limit` → `quota`; containing `Invalid API key` or `No API key` → `bad_key`; thrown fetch or non-2xx status → `network`. `search` with `Movie not found!` returns `[]` instead of throwing.

- [ ] **Step 1: Write failing tests** (fake `fetch` returning `{ ok: true, status: 200, json: async () => body }`)

```js
const ok = { Response:'True', imdbID:'tt1877830', Title:'The Batman', Year:'2022', Type:'movie', Plot:'When...', Genre:'Action, Crime', imdbRating:'7.8', Runtime:'176 min', Actors:'Robert Pattinson', Poster:'https://x/p.jpg' };
const info = await createOmdb({ apiKey:'K', fetch: fake(ok) }).byTitle('batman', '2022');
assert.equal(info.imdbId, 'tt1877830'); assert.equal(info.posterUrl, 'https://x/p.jpg'); assert.equal(info.source, 'omdb');
// requested URL contains 'apikey=K', 't=batman', 'y=2022'
assert.equal((await byTitleWith({ ...ok, Poster:'N/A' })).posterUrl, null);
await assert.rejects(byTitleWith({ Response:'False', Error:'Movie not found!' }), e => e.kind === 'not_found');
await assert.rejects(byTitleWith({ Response:'False', Error:'Request limit reached!' }), e => e.kind === 'quota');   // Review Focus 2
await assert.rejects(byTitleWith({ Response:'False', Error:'Invalid API key!' }), e => e.kind === 'bad_key');
await assert.rejects(createOmdb({ apiKey:'K', fetch: async () => { throw new Error('down'); } }).byId('tt1'), e => e.kind === 'network');
assert.deepEqual(await searchWith({ Response:'False', Error:'Movie not found!' }), []);
// search maps Search[] items to Candidate
// link.test.js
assert.equal(extractImdbId('https://www.imdb.com/title/tt1877830/?ref_=x'), 'tt1877830');
assert.equal(extractImdbId('http://www.omdbapi.com/?i=tt1877830&apikey=ABC123'), 'tt1877830');
assert.equal(extractImdbId('tt0111161'), 'tt0111161');
assert.equal(extractImdbId('https://example.com/nothing'), null);
```

- [ ] **Step 2: Run** `node --test` → FAIL
- [ ] **Step 3: Implement** the modules per Interfaces. Build URLs with `URLSearchParams`.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat: omdb client and imdb link parsing`

### Task 5: Jikan, posters, matching queue

**Files:**
- Create: `src/core/jikan.js`, `src/core/posters.js`, `src/core/titles.js`, `src/core/pipeline.js`, `test/jikan.test.js`, `test/pipeline.test.js`

**Interfaces:**
- Consumes: `ProviderError`, `TitleInfo`, `Candidate`, `createOmdb` shape, `openDb`.
- Produces:
  - `createJikan({ fetch?: typeof fetch }): { searchAnime(title: string, year?: string|null): Promise<TitleInfo|null> }`. Calls `GET https://api.jikan.moe/v4/anime?q=<title>&limit=5`; picks the result whose `year` equals the given year if any, else the first; maps `mal_id`, `title_english || title`, `synopsis`, `score`, `genres[].name` joined by `, `, `duration`, `images.jpg.large_image_url`; `source:'jikan'`, `type:'anime'`. Empty `data` → `null`. HTTP 429 → wait 1000 ms and retry once, then `ProviderError('network')`.
  - `savePoster(url: string|null, dir: string, key: string, fetch?: typeof fetch): Promise<string|null>` writes `<dir>/<key>.jpg` and returns the file name; returns `null` on any failure or null url. A poster failure never fails a match.
  - `upsertTitle(db, info: TitleInfo, posterFile: string|null): number` inserts or updates by `imdb_id` (OMDb) or `mal_id` (Jikan) and returns the title id.
  - `resolveLocation(db, locationId: number, deps: { omdb, jikan, savePoster: (url: string|null, key: string) => Promise<string|null> }): Promise<'matched'|'review'|'quota'|'network'|'bad_key'>`.
  - `runQueue(db, deps, onProgress?: (p: { processed: number, remaining: number }) => void): Promise<{ processed: number, remaining: number, stoppedBy: 'quota'|'network'|'bad_key'|null }>` runs `resolveLocation` over all `pending`, non-missing locations in id order, stopping at the first `quota`, `network` or `bad_key`.

`resolveLocation` order: (1) if another `matched` location has the same lower-cased `parsed_title` and `parsed_year` (null equals null), reuse its `title_id` with no request; (2) if `parsed_title` has Arabic-script letters and no Latin letters, set `review` with no request; (3) `omdb.byTitle(title, year, season ? 'series' : null)`; (4) on `not_found`, `omdb.search`; any result → `review`; no result → `jikan.searchAnime`; a hit → matched with source `jikan`, otherwise `review`. A match saves the poster as `<imdbId or 'mal'+malId>`, upserts the title, sets `title_id` and `status='matched'`. Quota/network/bad_key leave the location `pending` and are returned.

- [ ] **Step 1: Write failing tests** (in-memory db with one location row per case; fake `omdb`/`jikan` objects that record calls)

```js
// matched via OMDb: location 'batman 2022' → status 'matched', title_id set, titles.imdb_id 'tt1877830'
// reuse: second location same parsed title+year on another drive → same title_id, omdb call count stays 1
// persian only: parsed_title 'بتمن' → 'review', zero omdb and jikan calls
// anime fallback: byTitle throws not_found, search → [], jikan returns info → 'matched', titles.source 'jikan'
// search has candidates → 'review', jikan not called
// quota (Review Focus 2): byTitle throws kind quota → returns 'quota', status stays 'pending'
// network (Review Focus 3): three pending locations, 2nd throws network → runQueue stoppedBy 'network',
//   1st 'matched', 2nd and 3rd 'pending', remaining 2
// poster failure: savePoster resolves null → still 'matched', poster_file null
// guessed location (guessed=1) that matches stays 'matched' with guessed still 1
// jikan.test.js: 429 then 200 → result returned and fetch called twice; empty data → null; year preference
```

- [ ] **Step 2: Run** `node --test` → FAIL
- [ ] **Step 3: Implement** the four modules per Interfaces. `runQueue` calls `onProgress` after each location.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat: jikan fallback, poster cache, matching queue`

### Task 6: Online Info Fix and candidate picking

**Files:**
- Create: `src/core/fix.js`, `test/fix.test.js`

**Interfaces:**
- Consumes: `extractImdbId`, `omdb.byId`, `omdb.search`, `upsertTitle`, `savePoster`, `Candidate`.
- Produces:
  - `applyFix(db, target: { titleId?: number, locationId?: number }, link: string, deps: { omdb, savePoster }): Promise<{ ok: true, titleId: number } | { ok: false, error: 'invalid_link'|'not_found'|'quota'|'bad_key'|'network' }>`.
  - `getCandidates(db, locationId: number, deps: { omdb }): Promise<Candidate[]>` searches OMDb with the location's `parsed_title` and `parsed_year`.
  - `pickCandidate(db, locationId: number, imdbId: string, deps): ReturnType<typeof applyFix>` equals `applyFix(db, { locationId }, imdbId, deps)`.

`applyFix` behavior: `extractImdbId(link)` null → `invalid_link` with no request. `omdb.byId` errors map to the same error kinds and change nothing. On success: if a title with that `imdb_id` already exists, move every location of the target's old title (or the single target location) to it, delete the old title row when no location references it, and use the existing id; otherwise the target title row is updated in place (or a new title row is created for a location with no title). All affected locations get `status='matched'`, `pinned=1`, `guessed=0`. The poster is re-downloaded.

- [ ] **Step 1: Write failing tests**

```js
// invalid link → { ok:false, error:'invalid_link' } and fake omdb.byId not called
// OMDb link with apikey: byId called with 'tt1877830'; stored settings/db rows contain no 'apikey' text anywhere
// fix on matched title: row updated in place (same id), title text now from byId, location pinned = 1
// fix on 'review' location with no title: new title created, location matched + pinned
// merge: titles A (tt1) and B (tt2); fix B with a link to tt1 → B's locations now point to A, B row deleted, ok.titleId === A
// error from omdb (not_found / quota / network) → ok:false with same kind, database unchanged
// pinned location is not re-parsed or re-matched by syncScan afterwards (use syncScan from Task 3)
// getCandidates passes parsed title and year to omdb.search
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat: online info fix and candidate picking`

### Task 7: Entry listing and fuzzy search

**Files:**
- Create: `src/core/library.js`, `src/core/search.js`, `test/library.test.js`, `test/search.test.js`

**Interfaces:**
- Produces:
  - `listEntries(db): Entry[]` where `Entry = { key: string, titleId: number|null, locationId: number|null, title: string, year: string|null, type: string|null, plot: string|null, genres: string|null, rating: string|null, runtime: string|null, actors: string|null, posterFile: string|null, status: 'matched'|'review'|'pending', guessed: boolean, locations: { id: number, driveSerial: string, driveLabel: string, online: boolean, relPath: string, folderName: string, season: string|null, isEmpty: boolean, missing: boolean }[] }`. One entry per title (`key` `t:<id>`, status `matched`, `guessed` true if any location is guessed). Each location with no `title_id` is its own entry (`key` `l:<id>`, `title` = `parsed_title || folder_name`, its own status).
  - `createSearch(db): { query(q: string): Entry[], invalidate(): void }`. Fuse.js over `title`, `locations[].folderName`, `genres`, `actors` with `threshold: 0.35`, title weighted highest. Empty or blank query returns all entries sorted by title. The Fuse index is built on first use and after `invalidate()`.

- [ ] **Step 1: Write failing tests**

```js
// two locations (two drives) of one title → one entry with locations.length === 2
// unmatched location → own entry with status 'review', title from parsed_title
// season stored per location: 'S01' folder and 'S02' folder of one series show season '01' and '02' under one entry
// empty folder entry: locations[0].isEmpty === true
// search 'batmn' finds 'The Batman'
// search 'بتمن' finds the entry whose folder_name is 'بتمن 2022' even though the title is English
// blank query returns everything; query that matches nothing returns []
// after adding a title and calling invalidate(), query finds it
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat: entry listing and fuzzy search`

### Task 8: API layer and Electron shell

**Files:**
- Create: `src/api.js`, `src/main.js`, `src/preload.js`, `test/api.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces `createApi({ db, userDataDir: string, fetch?, listDrives?: () => Promise<Drive[]> }): Api` with async methods (all return plain JSON-safe values):
  - `getSettings(): { language, omdbKey, patterns, ignore, collections }`, `setSettings(partial): void` (also invalidates search).
  - `getDrives(): { serial, label, root, online }[]` (calls `listDrives`, `refreshDrives`, returns the drives table).
  - `addRoot(absPath: string): { ok: boolean, error?: 'no_drive' }` (uses `toDriveRel`, inserts into `roots`), `removeRoot(id: number): void`, `getRoots(): { id, driveSerial, driveLabel, relPath, online }[]`.
  - `scan(): { scanned: number }` scans every root whose drive is online, using current `ignore`, `collections`, `patterns`, then `syncScan`.
  - `startQueue(onProgress): ReturnType<typeof runQueue>` builds `omdb`, `jikan`, `savePoster` from settings and `userDataDir/posters`; a missing `omdbKey` returns `{ processed: 0, remaining: n, stoppedBy: 'bad_key' }` without any request.
  - `getEntries(query?: string): Entry[]`, `applyFix(target, link)`, `getCandidates(locationId)`, `pickCandidate(locationId, imdbId)` (thin wrappers over Task 6), `posterPath(file): string`.
- `src/main.js`: creates the BrowserWindow (`contextIsolation: true`, `nodeIntegration: false`, `preload`), opens `<userData>/archive.db`, registers one `ipcMain.handle('api:<method>')` per Api method (forwarding queue progress as `api:progress` events), and registers a `poster://` protocol that serves files from `<userData>/posters/` only (reject any path containing `..`). `src/preload.js` exposes `window.api` with the same method names through `contextBridge`.

- [ ] **Step 1: Write failing tests** (`test/api.test.js`, temp dir as fake drive root, fake fetch)

```js
// addRoot with a path under the fake drive root → ok, getRoots has relPath 'Movies'; path outside any drive → { ok:false, error:'no_drive' }
// scan() after creating Movies/'batman 2022' and Movies/Empty → getEntries() has 2 entries, one with isEmpty
// startQueue with no omdbKey → stoppedBy 'bad_key', fake fetch call count 0
// startQueue with key and fake OMDb → entry becomes matched, poster file exists under userDataDir/posters
// setSettings({ patterns: ['{title}'] }) then getSettings().patterns equals it
// the scan never writes into the media folder: directory listing before and after scan is identical (read-only constraint)
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `api.js` per Interfaces, then `main.js` and `preload.js`.
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Smoke check** `node -e "console.log(process.versions.node)"` inside Electron: run `npx electron -e` is not available, so create a throwaway `smoke.js` that prints `process.versions.node` and `typeof require('node:sqlite').DatabaseSync`, run it with `npx electron smoke.js` (use `xvfb-run -a` if there is no display), then delete it. Expected output: a Node version of 24 or higher and `function`. If the Electron binary cannot be downloaded or run in this environment, record that in the final report and move on. If `node:sqlite` is missing in Electron, replace it with `better-sqlite3` behind the same `openDb` interface.
- [ ] **Step 6: Commit** `feat: api layer and electron shell`

### Task 9: Bilingual interface

**Files:**
- Create: `src/renderer/index.html`, `src/renderer/app.js`, `src/renderer/styles.css`, `src/renderer/i18n.js`, `test/i18n.test.js`

**Interfaces:**
- Consumes: `window.api` (Task 8 method names).
- Produces: `i18n.js` exports `STRINGS = { fa: {...}, en: {...} }` and `t(lang, key): string` (works both as a browser script and via `require` in the test).

Screens: (a) toolbar: search box, language toggle, Scan, Fetch info (shows `processed/remaining` and a "daily limit reached" or "no internet" message from `stoppedBy`), Settings; (b) left column: drives with online/offline badge and roots with add/remove (add takes a typed path, with a Browse button using the Electron folder dialog); (c) centre: poster grid of entries, badges for `review`, `pending`, guessed ("check"), empty, missing, drive offline; (d) detail panel: poster, title, year, type, rating, runtime, genres, actors, plot, all locations with drive label and path, and the **Online Info Fix** button (a text field accepting an IMDb or OMDb link, shows the returned error); for `review` entries the panel lists `getCandidates` results to pick from; (e) settings: OMDb key, folder patterns (one per line, with the token legend), ignore list, collection folders. Language `fa` sets `<html dir="rtl" lang="fa">`, `en` sets `ltr`; the choice is saved with `setSettings({ language })`. Posters load via `poster://<file>`. Render the grid in chunks of 200 cards as the user scrolls so a large archive stays responsive.

- [ ] **Step 1: Write failing test** `test/i18n.test.js`

```js
assert.deepEqual(Object.keys(STRINGS.fa).sort(), Object.keys(STRINGS.en).sort());
assert.equal(t('en', 'online_info_fix'), 'Online Info Fix');
assert.ok(t('fa', 'online_info_fix').length > 0);
assert.equal(t('en', 'missing_key_xyz'), 'missing_key_xyz');   // unknown key returns the key
```

- [ ] **Step 2: Run** `node --test test/i18n.test.js` → FAIL
- [ ] **Step 3: Implement** `i18n.js` first (keys for every label above), then `index.html`, `app.js`, `styles.css`. Use the `frontend-design` skill's guidance for a clean, readable layout; use logical CSS properties (`margin-inline-start`) so RTL needs no separate stylesheet. No UI framework.
- [ ] **Step 4: Run** `node --test` → PASS. Then, if Electron runs here, launch with `xvfb-run -a npx electron .` for 5 seconds with a temp userData dir and confirm no console errors; otherwise record that the UI was not run.
- [ ] **Step 5: Commit** `feat: bilingual renderer`

### Task 10: Packaging and Persian guide

**Files:**
- Create: `README.fa.md`
- Modify: `package.json` (add `build` section)

- [ ] **Step 1: Add** an `electron-builder` `build` config: `appId: "com.local.moviearchive"`, `productName: "Movie Archive"`, `win.target: "nsis"`, `files: ["src/**", "package.json"]`.
- [ ] **Step 2: Write `README.fa.md`** in Persian: install Node, `npm install`, `npm start`, `npm run dist` (must be run on Windows, output in `dist/`), how to get a free OMDb key at omdbapi.com, how to add a drive folder, how to write folder patterns (with the examples from the spec), what review/pending/guessed/missing/empty badges mean, the 1000-requests-per-day limit, and the Online Info Fix button.
- [ ] **Step 3: Verify** `node --test` passes in full and `git status` is clean after the commit.
- [ ] **Step 4: Commit** `docs: persian guide and packaging config`
