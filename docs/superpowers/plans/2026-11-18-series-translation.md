# Series, Translation, Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the movie archive app with recursive scanning, series episodes (OMDb) and anime episodes (Jikan), cached search, Persian translation (MyMemory) stored forever, All/Movies/Series tabs, genre tag filter, sorting, an open-folder button, an IMDb page button and extra OMDb fields.

**Architecture:** Same as v1: logic in `src/core/*.js` with injected I/O and `node --test` fakes, `src/api.js` wires it, `src/main.js`/`src/preload.js` only forward IPC, the renderer is vanilla JS. New tables hold episodes, translations and a generic cache. Electron-only calls (`shell.openPath`, `shell.openExternal`) are injected into `createApi` so tests stay Electron-free.

**Tech Stack:** unchanged (Electron 45, `node:sqlite`, `fuse.js`, `electron-updater`). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-18-series-translation-design.md` (Persian; adds to `2026-11-17-movie-archive-design.md`)

## Global Constraints

- All v1 constraints stay: the app never writes, renames, moves or deletes anything in the user's media folders; metadata only from OMDb and Jikan; the OMDb key comes only from the `omdbKey` setting; folder keys are `(drive serial, relative path with "/")`; tests use fakes and never touch the network; commit messages end with the two trailer lines below.
- Episode data source is OMDb only for series (`?i=<imdbId>&Season=<n>` for the list, `?i=<episodeImdbId>&plot=full` for each plot). Anime episodes come from Jikan.
- Translation is MyMemory only: `GET https://api.mymemory.translated.net/get?q=<text>&langpair=en|fa[&de=<email>]`, at most 450 characters per request. A quota or error answer is never stored as a translation.
- Translations are keyed by the SHA-1 of the source chunk and stored in table `translations`; a stored chunk is never requested again.
- Genres are translated by a fixed dictionary in `src/renderer/i18n.js`; names, episode names, awards and actors stay English.
- Season token (folder name): `/(?:^|[\s._-])(?:s|season[\s._-]?|فصل[\s._-]?)(\d{1,2})(?![A-Za-z\d])/iu`. Video extensions: `mkv mp4 avi mov wmv m4v ts m2ts mpg mpeg flv webm iso vob`. Maximum scan depth 8. Symlinks are not followed.
- Default ignored folder names (case-insensitive, added to the v1 list): `specials`, and any name matching `/^(cd|disc|disk)[\s._-]?\d+$/i`.
- Tabs: `all`, `movie`, `series`. Anime (and any title whose type is not `movie` or `series`) appears only under `all`.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01A45qyYXJZxWk5AhzQZd7Sy` (blank line before them).

## Review Focus

1. MyMemory quota text (`quotaFinished: true`, HTTP 429, `MYMEMORY WARNING…`) must raise `quota` and must not be stored; a half-translated plot keeps the chunks already stored. (Task 5)
2. Folder names `S1mone (2002)`, `Se7en`, `Season 1` (under `Mentalist/`), `Mentalist S01` and `mentalist.s01.1080p` are classified correctly. A container with only subfolders and no year is opened; `Movie (2010)` holding `CD1` and `CD2` is one title. (Task 2)
3. An episode with no plot on OMDb gets `''` and is never requested again; a quota stop mid-season resumes at the next episode without re-requesting season lists. (Task 4)
4. A title search with no year and two matching titles (Dune 1984 and 2021) is not auto-picked. (Task 3)
5. `openLocation` returns `offline` for an offline drive and `missing` for a vanished folder, and never opens a path that is not built from a stored location. (Task 6)

---

### Task 1: Schema, cache helper, extra fields, season and episode requests

**Files:**
- Modify: `src/core/db.js`, `src/core/omdb.js`, `src/core/jikan.js`, `src/core/titles.js`
- Create: `src/core/cache.js`
- Test: `test/db.test.js`, `test/cache.test.js`, `test/omdb.test.js`, `test/jikan.test.js`, `test/pipeline.test.js` (title fields only)

**Interfaces:**
- Produces:
  - `openDb` also creates `episodes(title_id INTEGER NOT NULL, season INTEGER NOT NULL, number INTEGER NOT NULL, ext_id TEXT, name TEXT, released TEXT, rating TEXT, plot TEXT, PRIMARY KEY(title_id, season, number))`, `translations(hash TEXT PRIMARY KEY, text TEXT NOT NULL)`, `cache(key TEXT PRIMARY KEY, value TEXT NOT NULL)`, and columns `titles.director`, `titles.awards`, `titles.rated`, `titles.country` (TEXT), `titles.total_seasons` (INTEGER). A database created before this task gets the missing `titles` columns added on open. `DEFAULTS.translateEmail = ''`.
  - `TitleInfo` gains `director`, `awards`, `rated`, `country: string|null` and `totalSeasons: number|null` (OMDb: `Director`, `Awards`, `Rated`, `Country`, `totalSeasons`; `"N/A"` is `null`; Jikan: `rated` = `rating` field, the rest `null`). `upsertTitle` stores them.
  - `cache.js`: `getCache(db, key): any|undefined`, `putCache(db, key, value): void`, `cached(db, key, loader: () => Promise<any>): Promise<any>` (calls the loader only when the key is missing; a throwing loader stores nothing; falsy values such as `[]` are stored), `searchCached(db, omdb, title: string, year?: string|null): Promise<Candidate[]>` with key `s|<lowercased title>|<year or ''>`.
  - `omdb.season(imdbId: string, season: number): Promise<{ totalSeasons: number|null, episodes: { number: number, name: string, released: string|null, rating: string|null, imdbId: string }[] }>`.
  - `jikan.episodes(malId: number): Promise<{ number: number, name: string, released: string|null, rating: string|null }[]>` (follows `pagination.has_next_page`, at most 20 pages; `released` is the first 10 characters of `aired`; `rating` is `String(score)`), `jikan.episode(malId: number, number: number): Promise<string|null>` (the synopsis). A 404 from Jikan gives `[]` and `null` respectively.

- [ ] **Step 1: Write failing tests**

```js
// db: new tables exist; an old titles table without the new columns (create it by hand in a temp file) gets them after openDb(file)
// cache.test.js
let n = 0; const loader = async () => { n++; return []; };
await cached(db, 'k', loader); await cached(db, 'k', loader); assert.equal(n, 1);        // [] is stored
await assert.rejects(cached(db, 'bad', async () => { throw new Error('x'); })); assert.equal(getCache(db, 'bad'), undefined);
// searchCached: two calls with ('Batman','2022') and ('batman','2022') call omdb.search once
// omdb: season('tt0758745', 1) → URL has i=tt0758745 and Season=1; body {Episodes:[{Title:'Pilot',Released:'2008-09-23',Episode:'1',imdbRating:'8.3',imdbID:'tt1'}],totalSeasons:'7'}
//   → { totalSeasons: 7, episodes:[{ number:1, name:'Pilot', released:'2008-09-23', rating:'8.3', imdbId:'tt1' }] }; imdbRating 'N/A' → null
// omdb byId maps Director/Awards/Rated/Country/totalSeasons ('N/A' → null)
// jikan: two pages (has_next_page true then false) → episodes concatenated, fetch called twice; episode(5, 2) → synopsis; 404 → null / []
// titles: upsertTitle stores director, awards, rated, country, total_seasons
```

- [ ] **Step 2: Run** `node --test` → FAIL (missing modules/columns)
- [ ] **Step 3: Implement** the interfaces above. `db.js` gets a `addColumn(db, table, name, type)` helper that checks `PRAGMA table_info`. `jikan.get` returns `{ data: null }` for status 404.
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `feat: schema, cache, extra title fields, season and episode requests`

### Task 2: Recursive scanner and sync

**Files:**
- Modify: `src/core/scanner.js`, `src/core/sync.js`
- Test: `test/scanner.test.js`, `test/sync.test.js`

**Interfaces:**
- Produces:
  - `scanFolder(absPath, relPath, opts: { ignore: string[], collections: string[], fsApi?, maxDepth?: number })` returns `{ ok: boolean, entries: { name: string, relPath: string, isEmpty: boolean, season: string|null, titleName: string }[], unreadable: string[] }`. `season` is the digits exactly as in the folder name (`"01"`). `titleName` is the string that `parseFolderName` should read: the folder name for a title folder; for a season folder the text before the season token (trimmed of separators), or the parent folder's name when that is empty.
  - Classification per child directory, in order: ignored → skip; unreadable → push its relPath to `unreadable`; season folder → one entry with `season`, never descended; has a season child, or is listed in `collections`, or has subfolders and no video file directly inside and no 4-digit year in its name → descend into its subfolders (it is no entry); otherwise one title entry (also when empty).
  - `syncScan` parses `e.titleName ?? e.name` and stores `season = e.season ?? parsed.season`; everything else as in v1.

- [ ] **Step 1: Write failing tests** (real temp dirs; helper `tree(dirs, files)`)

```js
// Mentalist/Mentalist S01, Mentalist/Mentalist S02 → two entries, season '01'/'02', titleName 'Mentalist', relPath 'Mentalist/Mentalist S01'
// Mentalist/Season 1, Mentalist/Season 2 → titleName 'Mentalist' (parent name), seasons '1','2'
// 'The Mentalist (2008)/S01' → titleName 'The Mentalist (2008)'
// mentalist.s01.1080p.bluray (at root) → season '01', titleName 'mentalist'
// 'S1mone (2002)' and 'Se7en' (empty folders) → title entries, season null
// 'Action' containing 'Alien' and 'Predator' (empty) → entries Alien, Predator; no entry for Action
// 'Movie (2010)' containing 'CD1','CD2' → one entry 'Movie (2010)'
// 'Inception' containing inception.mkv and 'Subs' → one entry 'Inception'
// 'Show' containing 'Season 1' and 'Specials' → one season entry only
// depth: a/b/c/d/e/f/g/h/i/j/k (all empty folders, each name without year) stops at maxDepth 8: no entry deeper than 8 (assert entries.length <= 1 and no throw)
// unreadable season folder → listed in unreadable, scan ok (reuse the v1 fake fs)
// sync: season entry inserts a location with season '01' and parsed_title 'Mentalist'; its folder_name stays 'Mentalist S01'
```
Keep every v1 scanner/sync test (they must still pass).

- [ ] **Step 2: Run** `node --test test/scanner.test.js test/sync.test.js` → FAIL
- [ ] **Step 3: Implement** a recursive `walk(abs, rel, name, parentName, depth)` inside `scanFolder`; one `readdirSync(abs, { withFileTypes: true })` per directory; entries sorted by relPath.
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `feat: recursive scanner with season and container detection`

### Task 3: Confident match from search, cached candidates

**Files:**
- Create: `src/core/match.js`
- Modify: `src/core/pipeline.js`, `src/core/fix.js`
- Test: `test/match.test.js`, `test/pipeline.test.js`, `test/fix.test.js`

**Interfaces:**
- Consumes: `searchCached`, `Candidate`.
- Produces: `pickConfident(parsed: { title: string, year: string|null, season: string|null }, candidates: Candidate[]): Candidate|null`. A candidate qualifies when its type is `movie` or `series` (`series` only when `season` is set), its start year (first four digits of `year`) is within 1 of the folder year (or either year is missing), and its normalised title equals the folder title or is within `floor(length * 0.15)` edits (normalise: lowercase, strip accents, keep letters and digits, drop a leading `the`). With no folder year and two or more qualifying candidates the result is `null`. Otherwise the first qualifying candidate.

In `resolveLocation`: after `byTitle` throws `not_found`, candidates come from `searchCached(db, deps.omdb, t, year)`. A confident pick is loaded with `omdb.byId(pick.imdbId)`, matched like a normal hit and the location gets `guessed = 1`. Candidates but no confident pick → `review` (Jikan is not asked). No candidates → Jikan as before. `fix.getCandidates` uses `searchCached` for folder-based searches and `omdb.search(query)` (no cache) for typed queries.

- [ ] **Step 1: Write failing tests**

```js
// match: ('The Mentalist' 2008) picks {title:'The Mentalist', year:'2008–2015', type:'series'} with season '01'
// ('Mentalist', null, '01') picks the same via the 'the' rule; a movie candidate is skipped when season is set
// ('Dune', null) with candidates Dune 1984 and Dune 2021 → null            (Review Focus 4)
// ('Dune', '2021') → the 2021 one; ('Dune','2019') → null (year too far)
// type 'episode' candidates never qualify; typo 'Inceptoin' picks 'Inception'; 'Up' vs 'Us' → null (short title, 0 edits allowed)
// pipeline: byTitle not_found + one confident candidate → status matched, guessed 1, omdb.byId called with its id, jikan not called
// pipeline: not_found + ambiguous candidates → review, jikan not called
// pipeline: two review locations with the same title and year → omdb.search called once (cache)
// fix.getCandidates: folder search is cached; typed query is not
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `match.js` (small Levenshtein inside) and wire pipeline and fix.
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `feat: confident match from search results, cached candidates`

### Task 4: Episode queue (OMDb series, Jikan anime)

**Files:**
- Create: `src/core/episodes.js`
- Modify: `src/core/pipeline.js`, `src/core/fix.js`, `src/api.js` (only `removeRoot` cleanup and passing `sleep`)
- Test: `test/episodes.test.js`, `test/pipeline.test.js`, `test/fix.test.js`

**Interfaces:**
- Consumes: `omdb.season`, `omdb.byId`, `jikan.episodes`, `jikan.episode`, `getCache`, `putCache`.
- Produces:
  - `ownedSeasons(db, titleId: number): number[]` — the numbers of `locations.season` (not missing, `Number()`), ascending. If any location of the title has no season: `1..titles.total_seasons` (when `total_seasons` is unknown the result is `[1]`; fetching season 1 then learns it).
  - `runEpisodes(db, deps: { omdb, jikan, sleep?: (ms: number) => Promise<void> }): Promise<{ fetched: number, stoppedBy: 'quota'|'network'|'bad_key'|null }>`. Matched titles with `type = 'series'` (OMDb) or `source = 'jikan'` that have a non-missing location. Phase A (all titles first): for each owned season with no `episodes` rows and no cache key `season-none:<titleId>:<n>`, call `omdb.season`, insert rows (`plot` NULL), set `titles.total_seasons` from the answer; `not_found` stores the cache key and moves on. Phase B: for each episode with `plot IS NULL` (owned seasons only, by title id, season, number) call `omdb.byId(ext_id)`; store `plot` (and `rating` when the answer has one), `''` when OMDb has no plot or answers `not_found`. Jikan titles: `jikan.episodes(mal_id)` into season 1 (phase A), then `jikan.episode(mal_id, number)` per episode with `await sleep(400)` between Jikan requests (phase B). `quota`, `network` and `bad_key` stop the run and return it as `stoppedBy`; every other error is thrown. `fetched` counts requests that stored data.
  - `runQueue` returns `{ processed, remaining, stoppedBy, episodes }`; it runs `runEpisodes` only when the location loop was not stopped; `episodes` is `fetched`. `deps.sleep` defaults to a real timer.
  - `applyFix` re-pointing a title in place also deletes that title's `episodes` rows and sets `total_seasons = NULL`; the title-deleting paths (`applyFix` merge, `api.removeRoot`) delete `episodes` rows whose title no longer exists.

- [ ] **Step 1: Write failing tests** (fake omdb/jikan recording calls; `sleep: async () => {}`)

```js
// owned seasons: locations S01 and S03 → season() called for 1 and 3 only, never 2
// a location without season and total_seasons 3 → seasons 1..3
// plots: each episode gets byId(ext_id); plot and rating stored; 'N/A'-plot answer → plot ''
// Review Focus 3: quota on the 2nd byId → stoppedBy 'quota'; second run with a working fake requests only the episodes still NULL and no season lists
// not_found season → no rows, cache key season-none:<id>:<n> set, next run does not call season() again
// jikan title: episodes() once, then episode() per number; sleep called between them; 404 (null) synopsis → ''
// runQueue: stoppedBy from the location loop skips runEpisodes; otherwise result.episodes === fetched
// fix: re-pointing a title deletes its episodes; merge deletes the orphan title's episodes
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `episodes.js`, hook it into `runQueue`, add the cleanups.
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `feat: episode queue for series and anime`

### Task 5: MyMemory translator and genre dictionary

**Files:**
- Create: `src/core/translate.js`
- Modify: `src/renderer/i18n.js`
- Test: `test/translate.test.js`, `test/i18n.test.js`

**Interfaces:**
- Produces:
  - `splitForTranslation(text: string, max = 450): string[]` — splits after `. `, `! `, `? ` boundaries into chunks of at most `max` characters; a sentence longer than `max` is split at word boundaries; joining the chunks with a space gives back the text (whitespace-normalised).
  - `createTranslator({ fetch?: typeof fetch, email?: string }): { translate(text: string): Promise<string> }` for one chunk. Throws `ProviderError('quota')` when the body has `quotaFinished === true`, `responseStatus` is 429, or the text starts with `MYMEMORY WARNING`; `ProviderError('network')` for a thrown fetch or any other non-200 `responseStatus`. Decodes `&amp; &quot; &#39; &lt; &gt;`.
  - `translateCached(db, translator, text: string): Promise<string>` — splits the text, looks each chunk up in `translations` by SHA-1 hex of the chunk, translates and stores only the missing ones, joins with a space. Text that already contains Arabic-script letters and no Latin letters is returned unchanged. A thrown error stops immediately; chunks stored before it stay stored.
  - In `i18n.js`: `GENRES_FA` (OMDb genre names → Persian: Action اکشن, Adventure ماجراجویی, Animation انیمیشن, Biography زندگی‌نامه‌ای, Comedy کمدی, Crime جنایی, Documentary مستند, Drama درام, Family خانوادگی, Fantasy فانتزی, Film-Noir فیلم نوآر, History تاریخی, Horror ترسناک, Music موسیقی, Musical موزیکال, Mystery معمایی, Romance عاشقانه, Sci-Fi علمی‌تخیلی, Short کوتاه, Sport ورزشی, Thriller هیجان‌انگیز, War جنگی, Western وسترن, Reality-TV تلویزیون واقعی, Talk-Show گفتگو محور, Game-Show مسابقه‌ای, News خبری, Adult بزرگسال) and `genreLabel(lang: 'fa'|'en', genre: string): string` (unknown genre or `en` → the genre itself).

- [ ] **Step 1: Write failing tests**

```js
// split: a 1000-char text of 40-char sentences gives chunks ≤ 450 whose joined text equals the input; a single 600-char sentence without punctuation is split on spaces
// translate: URL has q, langpair=en|fa and de=<email> only when an email is given
// Review Focus 1: body {quotaFinished:true, responseData:{translatedText:'MYMEMORY WARNING: YOU USED ALL…'}} → rejects kind 'quota'; the same text with responseStatus 200 and quotaFinished false still rejects (warning prefix); status 429 → quota; fetch throws → network; status 403 → network
// entities: 'it&#39;s &quot;x&quot;' → 'it's "x"'
// translateCached: second call with the same text makes zero fetch calls; a text of 3 chunks where the 3rd request hits quota → rejects, 2 chunks stored, next call with a working fake requests only the 3rd
// translateCached never stores a quota warning text (translations table empty after a quota failure on the first chunk)
// Persian text is returned unchanged with no fetch
// i18n: genreLabel('fa','Horror') === 'ترسناک'; ('fa','Unknown') === 'Unknown'; ('en','Horror') === 'Horror'; every genre name in the list above has an entry
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** per Interfaces (`crypto.createHash('sha1')`).
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `feat: MyMemory translator with stored translations, Persian genre names`

### Task 6: Library, search, API and IPC

**Files:**
- Modify: `src/core/library.js`, `src/core/search.js`, `src/api.js`, `src/main.js`, `src/preload.js`
- Test: `test/library.test.js`, `test/search.test.js`, `test/api.test.js`

**Interfaces:**
- Consumes: `translateCached`, `createTranslator`, `runQueue`.
- Produces:
  - `Entry` (from `listEntries`) gains: `imdbId: string|null`, `genreList: string[]` (the `genres` text split on `, `), `director`, `awards`, `rated`, `country: string|null`, `totalSeasons: number|null`, `kind: 'movie'|'series'|'other'`, `addedOrder: number` (smallest location id). `kind`: title type `movie` → `movie`, `series` → `series`, any other title type → `other`; an unmatched location → `series` when it has a season, otherwise `movie`.
  - `createSearch(db).query(opts: { query?: string, tab?: 'all'|'movie'|'series', genres?: string[], sort?: 'name'|'year'|'rating'|'added' }): { entries: Entry[], genres: { name: string, count: number }[] }`. Order of work: text search → tab → genre counts (computed here) → genre filter (all selected genres required, case-insensitive) → sort (`name` ascending, `year` newest first, `rating` highest first with missing last, `added` newest first). Default `{}` equals `{ query: '', tab: 'all', genres: [], sort: 'name' }`. Genre counts are sorted by count descending, then name.
  - `createApi({ db, userDataDir, fetch?, listDrives?, openPath?: (p: string) => Promise<string>, openExternal?: (url: string) => Promise<void> })`; both default to no-ops that succeed. New or changed methods: `getEntries(opts = {})` as above; `getEpisodes(titleId: number): { season: number, episodes: { number: number, name: string, released: string|null, rating: string|null, plot: string|null }[] }[]` (`plot` `''` becomes `null`); `translate(text: string): Promise<{ ok: true, text: string } | { ok: false, error: 'quota'|'network' }>`; `openLocation(locationId: number): Promise<{ ok: true } | { ok: false, error: 'unknown'|'offline'|'missing' }>` (absolute path = drive root joined with the stored relative path; `offline` when the drive is not online; `missing` when `fs.existsSync` is false); `openImdb(titleId: number): Promise<{ ok: boolean }>` (only calls `openExternal` with `https://www.imdb.com/title/<imdb_id>/` when the id matches `/^tt\d{7,10}$/`). `translateEmail` joins `SETTING_KEYS`. `startQueue` passes the real `sleep`.
  - `main.js` passes `openPath: (p) => shell.openPath(p)` and `openExternal: (u) => shell.openExternal(u)`; `preload.js` METHODS gain `getEpisodes`, `translate`, `openLocation`, `openImdb`.

- [ ] **Step 1: Write failing tests**

```js
// library: genreList ['Action','Crime']; kind per rule; addedOrder; director/awards/rated/country/imdbId present
// search: tab 'series' returns only kind series; genres ['Horror','Comedy'] returns only titles with both; genre counts are computed before the genre filter but after tab and text
// sort: rating puts null last; year newest first; added newest first; name ascending (case-insensitive)
// api (temp dir drive root, fake openPath/openExternal/fetch):
//   openLocation: online drive + existing folder → openPath called with join(root, relPath), ok true; offline → { ok:false, error:'offline' } and openPath not called; deleted folder → 'missing'; unknown id → 'unknown'    (Review Focus 5)
//   openImdb: opens https://www.imdb.com/title/tt1877830/ ; a title whose imdb_id is 'x; calc.exe' → ok false, openExternal not called
//   translate: fake MyMemory fetch → { ok:true, text }; second call makes no fetch; quota body → { ok:false, error:'quota' }
//   getEpisodes groups by season, plot '' → null
//   getEntries({ tab:'movie', sort:'year' }) returns { entries, genres }
```
Update the v1 tests that call `getEntries()` / `search.query('…')` to the new shapes.

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `feat: tabs, genre filter, sorting, episodes, translate and open-path API`

### Task 7: Interface

**Files:**
- Modify: `src/renderer/index.html`, `src/renderer/app.js`, `src/renderer/i18n.js`, `src/renderer/styles.css`
- Test: `test/i18n.test.js` (key parity only)

**Interfaces:**
- Consumes: `api.getEntries(opts)`, `api.getEpisodes`, `api.translate`, `api.openLocation`, `api.openImdb`, `genreLabel`, new settings key `translateEmail`.

Behaviour:
- Tabs row «همه / فیلم‌ها / سریال‌ها» (`All / Movies / Series`) above the grid; a sort `<select>` (name, year, rating, newest); a genre chip row built from the `genres` answer (chip text via `genreLabel`, shows the count, click toggles, several can be active, a «پاک کردن» button clears them). Tab, genres and sort are kept in `state` and sent with every `getEntries` call; search typing keeps them.
- Cards and detail show genres as small tag chips (`genreLabel`); clicking a tag in the detail toggles that genre filter.
- Detail panel: facts for director, awards, rated, country (English text, `dir="auto"`); an IMDb button (only for entries with `imdbId`) calling `api.openImdb(titleId)`; every location row has an «Open folder» button calling `api.openLocation(location.id)` (disabled with a tooltip when the drive is offline or the folder is missing; an error result shows its message in the status line).
- Persian plot: in `fa` show the English plot at once, call `api.translate(plot)`, replace the text when it arrives and add the note «ترجمهٔ ماشینی»; on `quota` keep English and show «سهمیهٔ ترجمه تمام شد. ایمیل را در تنظیمات بگذار یا فردا امتحان کن».
- Series: below the facts, one collapsible block per season from `api.getEpisodes(titleId)` (title «فصل N — M قسمت»). Each episode row: number, name, release date, ⭐ rating, plot. Opening a season shows the English plots first and then, in `fa`, translates them one after the other (stops after the first `quota`). Episodes without plot show a muted «داستان هنوز دریافت نشده». A line under the seasons says how many episodes still lack a plot.
- Settings: a text input for `translateEmail` with help text («برای افزایش سهمیهٔ روزانهٔ ترجمه یک ایمیل بنویس»).
- All new text goes in both languages of `i18n.js`; the existing parity test must pass.

- [ ] **Step 1: Write failing test:** i18n parity already exists; add assertions that `t('en','tab_all')`, `t('en','tab_movie')`, `t('en','tab_series')`, `t('en','open_folder')`, `t('en','open_imdb')`, `t('en','sort_name')` are non-empty and not equal to their key.
- [ ] **Step 2: Run** `node --test test/i18n.test.js` → FAIL
- [ ] **Step 3: Implement** keys first, then the HTML, CSS and `app.js` changes. Use logical CSS properties so RTL needs no extra rules.
- [ ] **Step 4: Run** `node --test` → PASS, then seed a temporary data folder (movies, a series with episodes and plots, a genre set, one offline drive), launch `xvfb-run -a electron --no-sandbox` through a smoke script, click through tabs, a genre chip, the sort select, a season block, and check there are no console errors and the DOM shows the tags and the open-folder buttons; capture one `fa` and one `en` screenshot and look at them.
- [ ] **Step 5: Commit** `feat: tabs, genre tags, episodes and translation in the interface`

### Task 8: Documentation and agent guide

**Files:**
- Modify: `README.fa.md`, `AGENTS.md`

- [ ] **Step 1: Update** `README.fa.md`: recursive scanning and the folder rules (series folders, season names), tabs, genre filter, sort, open-folder and IMDb buttons, the series episode queue and the daily OMDb limit, translation with MyMemory (stored forever, the email setting and its limit), the known gaps from the spec.
- [ ] **Step 2: Update** `AGENTS.md`: new modules (`cache`, `match`, `episodes`, `translate`), the new rules (never store a MyMemory quota text; anime only under All; scan classification), and the known-gaps list from the spec.
- [ ] **Step 3: Verify** `node --test` passes in full and `git status` is clean after the commit.
- [ ] **Step 4: Commit** `docs: guide for series, translation and tabs`
