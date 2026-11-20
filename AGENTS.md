# Movie Archive — guide for coding agents

Electron app for Windows. It catalogs movies, series and anime kept in folders on several hard drives,
identifies each title from its **folder name**, and fills in poster, plot and details from OMDb
(Jikan/MyAnimeList as the anime fallback). UI is Persian (RTL) and English (LTR). The owner speaks Persian:
answer him in Persian, keep code and comments in English.

Specs (Persian, the authority): `docs/superpowers/specs/2026-11-17-movie-archive-design.md` (v1) and
`docs/superpowers/specs/2026-11-18-series-translation-design.md` (v2: recursive scan, series, translation, tabs; wins where it differs).
Plans: `docs/superpowers/plans/2026-11-17-movie-archive.md`, `docs/superpowers/plans/2026-11-18-series-translation.md`.

## Commands

- `npm test` — `node --test`, no network, no Electron needed. Run it before every commit.
- `npm start` — run the app (needs Electron; under Linux use `xvfb-run -a npx electron --no-sandbox .`).
- `npm run dist` — Windows installer in `dist/` (run on Windows).

## Layout

- `src/core/*.js` — all logic, plain CommonJS. I/O (`fetch`, `fs`, PowerShell) is passed in, so tests use fakes.
  `pattern` folder-name parser · `scanner` read-only recursive scan · `sync` scan → DB · `drives` drive serials ·
  `omdb`/`jikan` providers · `cache` stored API answers (`cache` table, `searchCached`) · `match` `pickConfident` (auto-pick of a search hit) ·
  `pipeline` matching queue · `episodes` season/episode queue · `translate` MyMemory + stored translations ·
  `fix` Online Info Fix · `library`/`search` entries, tabs, genre filter, sort, fuzzy search.
- `src/api.js` — wires core modules into one object. `src/main.js` + `src/preload.js` only expose it over IPC.
- `src/renderer/` — vanilla HTML/JS, `i18n.js` holds both languages (keys must match; `test/i18n.test.js` checks).
  UI: no framework, no build. Light/dark tokens live in `styles.css` (`:root` light, dark via `prefers-color-scheme` and `[data-theme]`); `theme.js` (loaded in `<head>`) applies/saves the choice in localStorage. Font Vazirmatn is bundled in `renderer/fonts` (OFL). CSP forbids inline styles, so set dynamic values with `el.style.setProperty`. Icons are inline SVG (`ICONS` in `app.js`). The drive list is intentionally NOT shown on the main screen; archive folders are managed in `#folders-dlg`. Detail is a side drawer (`#detail`, full-screen under 860px). Cards: poster + rating chip + dot beside the name; no-poster films get a hue from the title.
- `src/updater.js` — self-update from GitHub Releases (packaged app only). `createUpdater` backs the header Update button (`api.checkUpdate` → `{state: dev|latest|ready|error, version}`, then `api.installUpdate`); the startup check stays silent.

## Rules that must not break

- Never write, rename, move or delete anything inside the user's media folders. Scanning is read-only.
- Metadata only from OMDb and Jikan. No IMDb scraping, no IMDb dataset, no trailers/reviews/downloads, no semantic/embedding search.
- The OMDb key comes only from the `omdbKey` setting. A key inside a pasted OMDb link is ignored and never stored.
- Folder keys are (drive serial, relative path with `/`), never drive letters.
- A title with several folders or drives is one entry with many locations.
- OMDb answers HTTP 200 with `Response:"False"`; map errors to `ProviderError.kind` (`not_found`, `quota`, `bad_key`, `network`).
  `quota` and `network` stop the queue and leave the location `pending`.
- Scan classification (`scanner.js`): ignored name → skip; season token (`S01`, `Season 1`, `فصل 1`, not followed by a letter or digit)
  → one location, never opened, series name = text before the token or the parent folder; has a season child, is in `collections`,
  or has subfolders with no video and no year in its name → opened, not a location; otherwise one title (even if empty). Max depth 8,
  symlinks not followed, an unreadable folder is never marked missing.
- Never store a MyMemory quota or error text as a translation (`quotaFinished`, status 429, text starting `MYMEMORY WARNING` → `ProviderError('quota')`).
  Translations are stored per ≤450-char chunk (SHA-1 of the chunk), so quota mid-text loses nothing. Persian text is never sent.
- Episode plots come only from OMDb (series) or Jikan (anime, one request per episode, 400 ms apart). `episodes.plot` NULL = not fetched,
  `''` = source has none. Season lists that OMDb does not know are remembered under cache key `season-none:<titleId>:<n>`.
- Rescan is incremental: existing `(drive, rel_path)` rows keep status/title/pins/translations; only new folders are inserted (`syncScan` returns the count, `api.scan` returns `{scanned, added}`).
- A root with `single = 1` is one folder (one title, or a series), not a folder of titles. `scanFolder(..., { only })` keeps just that child; `syncScan` marks only that rel_path (and below) missing, never siblings.
- Collections: a folder that opens (no video of its own, or several separate movie files — `NOT_A_MOVIE` filters samples/trailers/episodes/disc parts) stores its rel path in `locations.collection` for every title under it (a series folder passes the outer collection through). `library.collectionEntries` adds one `kind: 'collection'` entry per folder with ≥2 members (All tab only). A file entry's `rel_path` is the video file; `api.openRel` opens its parent folder. `openCollection` only opens a path some stored location names as its collection.
- Attention state is computed in core (`library.attentionOf`): `ok` (no marker), `guess` (yellow dot), `problem` (red dot: pending/unmatched, empty or missing folder). An unplugged drive is NOT a problem. Collection entries are always `ok`. `search.query({query, tab, genres, attention, sort})` returns `{entries, genres, attentionCounts}`; each facet's counts honor the other facet's filter. Genres/status/sort live in the filter sheet (`#filter-dlg`), not a top chip row. Cards show the rating as a chip on the poster, no status text.
- Performance rules (measured: 100 films 24 s → 5 s): network work goes through `core/pool.js` (`api` passes `concurrency: 5`; core defaults to 1 so tests stay ordered). The queue never asks twice for the same film (in-flight map by title|year|season). Jikan is spaced by `createJikan({ minGap: 350 })`, not by callers. `openDb` sets WAL + `synchronous=NORMAL` and the `loc_twin`/`loc_title` indexes (a test checks the query plans; do not add a low-selectivity index like `locations(status)`, the planner then skips `loc_twin`). The grid asks for `getEntries({light: true})` (card fields only) and the open card for `getEntry(key)`; never send plots/cast for the whole list. Sorting uses one shared `Intl.Collator`. The fuzzy index is built on the first typed query. CSS: no `backdrop-filter` on repeated or sticky elements; cards use `content-visibility: auto`.
- Anime show only under the All tab (`kind` is `other`); there is no anime tab yet.
- The interface must not offer watched/favourite/random-pick features; the owner rejected them.
- TDD: write the failing test first, watch it fail, then fix.

## Release (how the owner updates the app)

1. Bump `version` in `package.json` (for example 0.1.0 → 0.2.0) and commit to `main`.
2. `git tag v0.2.0 && git push origin main --tags`.
3. GitHub Actions (`.github/workflows/release.yml`) runs the tests, builds the installer on Windows and publishes a
   GitHub Release. Installed copies check for it on start and install it when the app closes.
   The tag must equal `v` + the `package.json` version, or the job fails on purpose.
4. The installer is not code-signed, so Windows SmartScreen shows a warning on the first install.

## Known gaps (deferred on purpose)

- Queue can overwrite a manual fix applied while that location was still `pending`.
- `collections` setting matching is exact, case-sensitive, drive-relative, `/` only.
- Persian grid cards lack `dir="auto"` on name/year; Fuse search has no Persian normalisation (ي/ی, ك/ک, digits).
- PowerShell output encoding may garble Persian drive labels; a failed drive listing shows no message.
- Poster file name uses the imdbID unsanitised; old poster files are not deleted after a fix.
- No `setWindowOpenHandler`/`will-navigate` guard; IPC does not check the sender; malformed `poster://` URL can throw.
- `getEntries` sends every entry over IPC on each keystroke (fine up to a few thousand titles).
- All anime seasons map to one MyAnimeList entry (shown as season 1). A category folder with a year in its name is read as a movie
  unless listed in `collections`. Persian-only folder names still go to review (the owner searches an English title by hand).
- Machine translation can be poor and its free quota is small (about 5000 chars/day, 50000 with an e-mail in settings).
- Scan (`scanFolder`) is synchronous in the main process: fast on a local disk (5000 folders ≈ 60 ms) but untested on a cold USB drive. Full-size posters stay decoded while their card is on screen (about 0.5 MB each); no thumbnails yet.
- Never run on real Windows yet: PowerShell drive listing, the NSIS build and live OMDb/Jikan are untested.
