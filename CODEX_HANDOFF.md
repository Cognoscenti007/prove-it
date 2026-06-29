# Codex Handoff

## Current Goal

Prototype a BP debate analytics dashboard backed by PostgreSQL. The immediate backend goal is to let a user provide a Tabbycat tournament URL plus their speaker/team details, import tournament data, and display that user's ballots, motions, speaker scores, opponent teams, and rankings.

Completed so far:

- The Python scraper now writes directly to PostgreSQL instead of Excel.
- The Next.js app now has a PostgreSQL-backed Drizzle schema and query helpers.
- Sample `wds2026` data has been imported and verified in PostgreSQL.
- The dashboard page reads from PostgreSQL and displays tournament summary data.
- A participant lookup display exists for speaker-specific data.
- A browser-triggered scrape API and client scrape form exist. The flow now uses a POST request with a streamed newline-delimited JSON response instead of EventSource.

## Files Changed

- [scraper.py](./scraper.py)
- [drizzle.config.js](./drizzle.config.js)
- [.env.local](./.env.local)
- [src/db/schema.js](./src/db/schema.js)
- [src/db/index.js](./src/db/index.js)
- [src/db/queries.js](./src/db/queries.js)
- [src/app/page.js](./src/app/page.js)
- [src/app/api/scrape/route.js](./src/app/api/scrape/route.js)
- [src/components/ScrapeLookupForm.js](./src/components/ScrapeLookupForm.js)
- [CODEBASE_CHANGES.md](./CODEBASE_CHANGES.md)
- `package.json`
- `package-lock.json`

## Important Decisions

- Kept the scraper as a Python CLI and made it persist into PostgreSQL directly.
- Chose a normalized schema instead of mirroring the old Excel sheets one-for-one.
- Used a local default PostgreSQL connection for development:
  - host `127.0.0.1`
  - port `5432`
  - user `postgres`
  - password `SD2628`
  - database `debate_analytics`
- Added `DATABASE_URL` support for the Next.js app and Drizzle config.
- Preserved server-side database access only; the browser is not given credentials.
- Added dashboard-oriented read helpers rather than exposing raw SQL in pages.
- The web scrape prototype uses `POST /api/scrape` and streams newline-delimited JSON progress events to the browser.
- The client form calls `/api/scrape` with `{ tournamentUrl }`, waits for a `done` event, then redirects to `/?tournamentUrl=<url>&speakerName=<speaker>&teamName=<team>`.
- The scraper itself still remains the source of truth for importing data. The frontend should not duplicate scraping logic.
- The API route verifies that the tournament is visible in PostgreSQL before emitting `done`.

## Commands Already Run

- `Get-Command psql`
- `Get-Service | Where-Object { $_.Name -like 'postgresql*' -or $_.DisplayName -like 'PostgreSQL*' }`
- `python -m py_compile scraper.py`
- `npm install pg`
- `npm run lint`
- `npm run build`
- `npx drizzle-kit check`
- Browser route smoke tests against `http://127.0.0.1:3000`
- PostgreSQL smoke-test queries through the new Node query layer
- Sample import from `wds2026_tab_data.xlsx` into PostgreSQL

## Tests Passed

- `python -m py_compile scraper.py`
- `npm run lint`
- `npm run build`
- `npx drizzle-kit check`
- Runtime PostgreSQL smoke test through `src/db/queries.js`
- Sample import validation from `wds2026_tab_data.xlsx`
- Previous smoke test showed the page could render existing `wds2026` participant data.

## Tests Failed Or Blocked

- `npm install pg` initially failed because network/cache access was restricted, then succeeded after approval.
- `npm run build` fails without network access because `next/font` tries to fetch Google Fonts. It passes when network access is approved.
- `next dev` can hit `spawn EPERM` inside the sandbox; it was started successfully with escalation.
- Historical bug: browser-triggered scrape did not appear to complete or refresh the dashboard correctly when using EventSource.

Observed bug details:

- User entered this valid tournament URL in the frontend:

```text
https://mukhtalif2025.calicotab.com/mukhtalif2026/
```

- The frontend did not return imported user results.
- The page reported that it failed to find data in imported tournaments.
- The user then ran the Python web scraper manually.
- Manual scraper import worked.
- PostgreSQL now contains the Mukhtalif tournament.
- After reloading the website, the dashboard displayed the Mukhtalif data.

Interpretation:

- The database schema and scraper are capable of importing this tournament.
- The participant display can read the imported tournament once the data exists.
- The failure is likely in the browser-triggered scrape orchestration, not in the scraper's extraction logic or the dashboard read queries.

Most likely causes to investigate:

- `/api/scrape` may not actually be invoked by the client form submit.
- The EventSource stream may be opening but failing silently before the Python scraper completes.
- The route may spawn `python`, while the working interpreter on this machine may require `py`, `python.exe`, or an explicit path.
- The scraper process may need network access or process-spawn permissions that are available in the terminal but not available from the Next route handler.
- The client may redirect/refresh before PostgreSQL writes are committed.
- The route only supports `GET` with `EventSource`; if the user submits in a way that falls back to normal navigation, it may only perform a lookup instead of a scrape.
- The frontend currently shows imported-data lookup errors in the same page area as scrape status, which can make a scrape failure look like a simple lookup miss.

Suggested fix:

- Implemented fix:
  - Replaced EventSource with `fetch("/api/scrape", { method: "POST" })`.
  - The browser now reads a streaming response manually with `response.body.getReader()`.
  - The API emits newline-delimited JSON events.
  - The API tries `process.env.PYTHON_PATH`, then `python`, then `py`.
  - The API waits for PostgreSQL visibility with `getTournamentByLookup(tournamentUrl)` before sending `done`.
  - The client does not redirect until `done` is received.
  - The frontend distinguishes scrape failure from an imported-data lookup miss more clearly.
- Test with the exact reported URL:

```text
https://mukhtalif2025.calicotab.com/mukhtalif2026/
```

## Remaining TODOs

- Continue manual browser testing of the scrape flow with new tournament URLs.
- Confirm the long-running browser scrape UX with `https://mukhtalif2025.calicotab.com/mukhtalif2026/` from an actual browser session.
- Keep the manual scraper path working.
- Decide whether to keep the old SQLite dependency once the migration is complete.
- Add seed or migration workflow documentation if the schema is going to evolve further.

## Exact Next Command To Continue

```powershell
npm run lint
```

Then start the dev server if needed:

```powershell
npm run dev
```

Primary manual test after making the next fix:

```text
Open http://127.0.0.1:3000, enter https://mukhtalif2025.calicotab.com/mukhtalif2026/ plus a known speaker name, and verify that status updates stream while the scraper runs.
```
