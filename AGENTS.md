# Movie Archive — guide for coding agents

Electron app for Windows. It catalogs movies, series and anime kept in folders on several hard drives,
identifies each title from its **folder name**, and fills in poster, plot and details from OMDb
(Jikan/MyAnimeList as the anime fallback). UI is Persian (RTL) and English (LTR). The owner speaks Persian:
answer him in Persian, keep code and comments in English.

Spec: `docs/superpowers/specs/2026-11-17-movie-archive-design.md` (Persian, the authority).
Plan it was built from: `docs/superpowers/plans/2026-11-17-movie-archive.md`.

## Commands

- `npm test` — `node --test`, no network, no Electron needed. Run it before every commit.
- `npm start` — run the app (needs Electron; under Linux use `xvfb-run -a npx electron --no-sandbox .`).
- `npm run dist` — Windows installer in `dist/` (run on Windows).

## Layout

- `src/core/*.js` — all logic, plain CommonJS. I/O (`fetch`, `fs`, PowerShell) is passed in, so tests use fakes.
  `pattern` folder-name parser · `scanner` read-only folder scan · `sync` scan → DB · `drives` drive serials ·
  `omdb`/`jikan` providers · `pipeline` matching queue · `fix` Online Info Fix · `library`/`search` entries and fuzzy search.
- `src/api.js` — wires core modules into one object. `src/main.js` + `src/preload.js` only expose it over IPC.
- `src/renderer/` — vanilla HTML/JS, `i18n.js` holds both languages (keys must match; `test/i18n.test.js` checks).
- `src/updater.js` — self-update from GitHub Releases (packaged app only).

## Rules that must not break

- Never write, rename, move or delete anything inside the user's media folders. Scanning is read-only.
- Metadata only from OMDb and Jikan. No IMDb scraping, no IMDb dataset, no trailers/reviews/downloads, no semantic/embedding search.
- The OMDb key comes only from the `omdbKey` setting. A key inside a pasted OMDb link is ignored and never stored.
- Folder keys are (drive serial, relative path with `/`), never drive letters.
- A title with several folders or drives is one entry with many locations.
- OMDb answers HTTP 200 with `Response:"False"`; map errors to `ProviderError.kind` (`not_found`, `quota`, `bad_key`, `network`).
  `quota` and `network` stop the queue and leave the location `pending`.
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
- Never run on real Windows yet: PowerShell drive listing, the NSIS build and live OMDb/Jikan are untested.
