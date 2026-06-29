# Codebase Changes So Far

## PostgreSQL Setup

- Confirmed PostgreSQL was already installed locally.
- Verified two running PostgreSQL services:
  - PostgreSQL 18 on port `5432`
  - PostgreSQL 14 on port `5434`
- Set the `postgres` user password to `SD2628` on both running instances.
- Added `C:\Program Files\PostgreSQL\18\bin` to the user PATH so new terminals can run `psql`.
- Created and used the local database `debate_analytics`.

## Scraper Changes

Updated `scraper.py` so it writes normalized data directly to PostgreSQL instead of exporting an Excel workbook.

Main changes:

- Removed Excel output behavior.
- Added PostgreSQL persistence using `psycopg2`.
- Added default local connection settings:
  - host: `127.0.0.1`
  - port: `5432`
  - user: `postgres`
  - password: `SD2628`
  - database: `debate_analytics`
- Added support for environment overrides:
  - `DATABASE_URL`
  - `PGHOST`
  - `PGPORT`
  - `PGUSER`
  - `PGPASSWORD`
  - `PGDATABASE`
- Added automatic creation of the target database if it does not exist.
- Added schema creation inside the scraper.
- Added idempotent upserts so rerunning a scrape updates existing tournament records instead of duplicating them.
- Improved text cleaning:
  - strips HTML tags
  - decodes HTML entities
  - handles empty and `NaN` values safely
- Added parsing helpers for:
  - integer values
  - decimal values
  - BP round result strings such as `1st (157)`
  - round labels
  - speaker lists
  - adjudicator lists

## Database Schema Added By The Scraper

The scraper now creates these PostgreSQL tables:

- `tournaments`
- `rounds`
- `teams`
- `speakers`
- `team_speakers`
- `team_tab_results`
- `team_round_results`
- `speaker_tab_results`
- `speaker_round_scores`
- `motions`
- `debates`
- `debate_teams`
- `speech_scores`
- `adjudicators`
- `debate_adjudicators`
- `team_breaks`

This schema is normalized around debate analytics entities rather than mirroring the old Excel sheets directly.

## Sample Data Import

Used `wds2026_tab_data.xlsx` as a fixture and imported it into PostgreSQL through the same persistence layer.

Verified imported counts:

```text
tournaments: 1
rounds: 8
teams: 59
speakers: 114
motions: 13
debates: 62
debate_teams: 248
speech_scores: 496
adjudicators: 25
team_breaks: 15
```

Also verified that `wds2026` has:

```text
62 debates
496 speech scores
```

## Next.js / Drizzle Database Layer

Started wiring the web app to PostgreSQL for backend reads.

Changes made:

- Installed the Node PostgreSQL driver:
  - `pg`
- Updated `drizzle.config.js`:
  - changed dialect from `sqlite` to `postgresql`
  - changed credentials to use `DATABASE_URL`
  - added loading of `.env.local` through `@next/env`
- Added `.env.local` with:

```text
DATABASE_URL=postgresql://postgres:SD2628@127.0.0.1:5432/debate_analytics
```

- Added `src/db/schema.js` with Drizzle table definitions matching the PostgreSQL schema created by `scraper.py`.
- Added `src/db/index.js`:
  - creates a pooled PostgreSQL connection using `pg`
  - exports a Drizzle database instance
  - exports a raw `query()` helper for dashboard queries
- Added `src/db/queries.js` with dashboard-oriented read helpers:
  - `getTournaments()`
  - `getTournamentBySlug(slug)`
  - `getSpeakersForTournament(tournamentId)`
  - `getSpeakerByName(tournamentSlug, speakerName)`
  - `getSpeakerRoundScores(tournamentSlug, speakerId)`
  - `getTeamTabResults(tournamentId)`
  - `getDebateHistoryByRound(tournamentId, roundNumber)`
  - `getBreakResults(tournamentId, breakCategory)`

## Validation Performed

Passed:

- `python -m py_compile scraper.py`
- `npm run lint`
- `npm run build` after allowing network access for Google font fetching
- Runtime smoke test against PostgreSQL using the new query layer

Smoke test result for `Nihar maheshwari` in `wds2026`:

```json
{
  "id": 28,
  "name": "Nihar maheshwari",
  "category": "Novice",
  "tournamentId": 1,
  "tournamentSlug": "/wds2026",
  "team": "White circular lawnmower",
  "rankText": "29=",
  "totalScore": 379,
  "averageScore": 75.8,
  "scoreStdev": 1.6,
  "debatesCount": null
}
```

## Known Caveats

- `npx drizzle-kit check` initially passed, but after changing `drizzle.config.js` to use a default import for `@next/env`, the final rerun failed with:

```text
Cannot destructure property 'loadEnvConfig' of 'import_env.default' as it is undefined.
```

- This means `drizzle.config.js` still needs a small compatibility fix before relying on Drizzle Kit commands.
- `npm install pg` reported existing audit warnings:
  - 6 moderate vulnerabilities
  - 2 high vulnerabilities
- Those audit issues were not addressed because fixing them may require unrelated dependency upgrades.
- The current web app does not yet display the database data in the UI. The DB layer and query helpers are ready for the next dashboard page implementation.

## Useful Commands

Open the database:

```powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d debate_analytics
```

Run the scraper:

```powershell
python scraper.py "https://your-tabbycat-site.com/wds2026/"
```

Run app checks:

```powershell
npm run lint
npm run build
```
