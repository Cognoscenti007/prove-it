import { connection } from "next/server";
import {
  Award,
  BarChart3,
  Database,
  Gauge,
  Medal,
  Search,
  Trophy,
  Users,
} from "lucide-react";
import ScrapeLookupForm from "@/components/ScrapeLookupForm.js";
import {
  getBreakResults,
  getDebateHistoryByRound,
  getParticipantTournamentData,
  getSpeakersForTournament,
  getTeamTabResults,
  getTournamentByLookup,
  getTournamentOverview,
  getTournaments,
} from "@/db/queries.js";

export const metadata = {
  title: "BP Debate Analytics",
  description: "Tournament analytics dashboard for British Parliamentary debate data.",
};

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "0";
  }
  return Number(value).toLocaleString("en", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function rankNumber(rankText) {
  const match = String(rankText ?? "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function firstParam(params, key) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function loadDashboardData(searchParams) {
  await connection();

  const params = await searchParams;
  const tournamentUrl = firstParam(params, "tournamentUrl").trim();
  const speakerName = firstParam(params, "speakerName").trim();
  const teamName = firstParam(params, "teamName").trim();
  const tournaments = await getTournaments();
  const tournament = tournamentUrl
    ? await getTournamentByLookup(tournamentUrl)
    : tournaments[0] ?? null;

  if (!tournament) {
    return {
      tournament: null,
      filters: { tournamentUrl, speakerName, teamName },
      lookupError: tournamentUrl ? `No imported tournament matched "${tournamentUrl}".` : null,
    };
  }

  const [overview, speakers, teams, breaks, roundOne, participant] = await Promise.all([
    getTournamentOverview(tournament.id),
    getSpeakersForTournament(tournament.id),
    getTeamTabResults(tournament.id),
    getBreakResults(tournament.id),
    getDebateHistoryByRound(tournament.id, 1),
    speakerName ? getParticipantTournamentData(tournament.id, speakerName, teamName) : null,
  ]);

  return {
    tournament,
    filters: {
      tournamentUrl: tournamentUrl || tournament.sourceUrl || tournament.slug,
      speakerName,
      teamName,
    },
    participant,
    participantSearched: Boolean(speakerName),
    overview,
    speakers: speakers.slice(0, 8),
    teams: teams.slice(0, 8),
    breaks: breaks.slice(0, 8),
    roundOne: roundOne.slice(0, 12),
  };
}

function Metric({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
            {label}
          </p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">{value}</p>
        </div>
        <div className={`flex size-11 items-center justify-center rounded-md ${tone}`}>
          <Icon aria-hidden="true" className="size-5" />
        </div>
      </div>
    </div>
  );
}

function DataTable({ title, eyebrow, columns, rows, emptyLabel }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-zinc-950">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-[0.12em] text-zinc-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-5 py-3 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={row.id ?? `${title}-${index}`} className="text-zinc-700">
                  {columns.map((column) => (
                    <td key={column.key} className="px-5 py-3">
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-5 py-6 text-zinc-500" colSpan={columns.length}>
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ParticipantPanel({ participant, participantSearched, filters }) {
  if (!participantSearched) {
    return null;
  }

  if (!participant) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        No speaker matched `{filters.speakerName}` for this imported tournament
        {filters.teamName ? ` and team "${filters.teamName}"` : ""}.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
          My data
        </p>
        <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-zinc-950">{participant.speaker.name}</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {participant.speaker.team ?? "Unknown team"} / Rank{" "}
              {participant.speaker.rankText ?? "unranked"} / Avg{" "}
              {formatNumber(participant.speaker.averageScore, 2)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-md bg-zinc-50 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Total</p>
              <p className="font-semibold text-zinc-950">
                {formatNumber(participant.speaker.totalScore)}
              </p>
            </div>
            <div className="rounded-md bg-zinc-50 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Rounds</p>
              <p className="font-semibold text-zinc-950">{participant.rounds.length}</p>
            </div>
            <div className="rounded-md bg-zinc-50 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Stdev</p>
              <p className="font-semibold text-zinc-950">
                {formatNumber(participant.speaker.scoreStdev, 2)}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="divide-y divide-zinc-100">
        {participant.rounds.map((round) => (
          <article key={round.debateId} className="grid gap-4 px-5 py-5 xl:grid-cols-[1fr_1.25fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-[#1f2a24] px-2.5 py-1 text-xs font-semibold text-white">
                  {round.round}
                </span>
                <span className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
                  {round.userSide}
                </span>
                <span className="rounded-md bg-[#fff1c7] px-2.5 py-1 text-xs font-medium text-[#775000]">
                  {round.userRole} / {formatNumber(round.speakerScore)}
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold leading-6 text-zinc-950">
                {round.motion ?? "Motion unavailable"}
              </h3>
              <p className="mt-2 text-sm text-zinc-600">
                {round.room} / {round.userTeam} / Team total{" "}
                {formatNumber(round.userTeamTotal)}
              </p>
            </div>
            <div className="overflow-x-auto rounded-md border border-zinc-200">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-[0.12em] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rank</th>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 font-medium">Team</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {round.teams.map((team) => (
                    <tr
                      className={team.team === round.userTeam ? "bg-[#e7f0ea] text-zinc-950" : "text-zinc-700"}
                      key={`${round.debateId}-${team.teamId}-${team.sidePosition}`}
                    >
                      <td className="px-3 py-2">{team.positionRank ?? "-"}</td>
                      <td className="px-3 py-2">{team.sidePosition}</td>
                      <td className="px-3 py-2">{team.team}</td>
                      <td className="px-3 py-2">{formatNumber(team.teamTotalScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default async function Home({ searchParams }) {
  let data;
  let loadError = null;

  try {
    data = await loadDashboardData(searchParams);
  } catch (error) {
    loadError = error;
    data = { tournament: null };
  }

  const {
    tournament,
    filters = {},
    lookupError,
    participant,
    participantSearched = false,
    overview,
    speakers = [],
    teams = [],
    breaks = [],
    roundOne = [],
  } = data;
  const importPending = Boolean(lookupError && filters.tournamentUrl);
  const topSpeaker = speakers[0];
  const topTeam = [...teams].sort((a, b) => rankNumber(a.rankText) - rankNumber(b.rankText))[0];

  return (
    <main className="min-h-screen bg-[#f5f1e8] text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-6 sm:px-8 lg:px-10">
        <header className="rounded-lg border border-zinc-900 bg-[#1f2a24] px-5 py-5 text-white shadow-sm sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[#f5c05a]">
                <Database aria-hidden="true" className="size-4" />
                PostgreSQL backend
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal sm:text-5xl">
                BP Debate Analytics
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-200 sm:text-base">
                {tournament
                  ? `Live overview for ${tournament.name ?? tournament.slug}.`
                  : "No tournament data is available yet."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:flex">
              <div className="rounded-md border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-300">Tournament</p>
                <p className="mt-1 font-semibold">{tournament?.slug ?? "None"}</p>
              </div>
              <div className="rounded-md border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-300">Status</p>
                <p className="mt-1 font-semibold">{loadError ? "Offline" : "Connected"}</p>
              </div>
            </div>
          </div>
        </header>

        {loadError ? (
          <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900">
            The dashboard could not connect to PostgreSQL. Check that the `debate_analytics`
            database is running and that `DATABASE_URL` is set correctly.
          </section>
        ) : null}

        <ScrapeLookupForm
          autoScrape={Boolean(lookupError && filters.tournamentUrl)}
          filters={filters}
          tournament={tournament}
        />

        {lookupError ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
            {importPending
              ? "Import starting. The scraper will populate PostgreSQL before this dashboard loads your data."
              : lookupError}
          </section>
        ) : null}

        {tournament ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                icon={Users}
                label="Speakers"
                value={formatNumber(overview.speakers)}
                tone="bg-[#e7f0ea] text-[#1f6f4a]"
              />
              <Metric
                icon={Trophy}
                label="Teams"
                value={formatNumber(overview.teams)}
                tone="bg-[#fff1c7] text-[#8a5a00]"
              />
              <Metric
                icon={BarChart3}
                label="Debates"
                value={formatNumber(overview.debates)}
                tone="bg-[#e9edf7] text-[#344d8f]"
              />
              <Metric
                icon={Gauge}
                label="Avg speech"
                value={formatNumber(overview.averageSpeechScore, 2)}
                tone="bg-[#f6e5df] text-[#9a4427]"
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Current leader
                </p>
                <div className="mt-4 flex items-start gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-[#1f2a24] text-[#f5c05a]">
                    <Medal aria-hidden="true" className="size-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-zinc-950">
                      {topSpeaker?.name ?? "No speaker tab data"}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      {topSpeaker
                        ? `${topSpeaker.team ?? "Unknown team"} | Avg ${formatNumber(topSpeaker.averageScore, 2)}`
                        : "Import a tournament to populate speaker standings."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Top team
                </p>
                <div className="mt-4 flex items-start gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-[#f5c05a] text-zinc-950">
                    <Award aria-hidden="true" className="size-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-zinc-950">
                      {topTeam?.name ?? "No team tab data"}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      {topTeam
                        ? `${formatNumber(topTeam.points)} points | ${formatNumber(topTeam.speakerScore)} speaker score`
                        : "Import a tournament to populate team standings."}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <ParticipantPanel
              filters={filters}
              participant={participant}
              participantSearched={participantSearched}
            />

            <DataTable
              eyebrow="Speaker tab"
              title="Top Speakers"
              rows={speakers}
              emptyLabel="No speaker rows found."
              columns={[
                { key: "rankText", label: "Rank" },
                { key: "name", label: "Speaker" },
                { key: "team", label: "Team" },
                {
                  key: "averageScore",
                  label: "Average",
                  render: (row) => formatNumber(row.averageScore, 2),
                },
                {
                  key: "totalScore",
                  label: "Total",
                  render: (row) => formatNumber(row.totalScore),
                },
              ]}
            />

            <div className="grid gap-4 xl:grid-cols-2">
              <DataTable
                eyebrow="Team tab"
                title="Top Teams"
                rows={teams}
                emptyLabel="No team rows found."
                columns={[
                  { key: "rankText", label: "Rank" },
                  { key: "name", label: "Team" },
                  {
                    key: "points",
                    label: "Points",
                    render: (row) => formatNumber(row.points),
                  },
                  {
                    key: "speakerScore",
                    label: "Speaker score",
                    render: (row) => formatNumber(row.speakerScore),
                  },
                ]}
              />

              <DataTable
                eyebrow="Breaks"
                title="Break Results"
                rows={breaks}
                emptyLabel="No break rows found."
                columns={[
                  { key: "breakCategory", label: "Break" },
                  { key: "rank", label: "Rank" },
                  { key: "team", label: "Team" },
                  { key: "breakPosition", label: "Position" },
                ]}
              />
            </div>

            <DataTable
              eyebrow="Round sample"
              title="Round 1 Ballot Rows"
              rows={roundOne}
              emptyLabel="No ballot rows found for round 1."
              columns={[
                { key: "room", label: "Room" },
                { key: "sidePosition", label: "Side" },
                { key: "team", label: "Team" },
                { key: "speaker", label: "Speaker" },
                { key: "role", label: "Role" },
                {
                  key: "speakerScore",
                  label: "Score",
                  render: (row) => formatNumber(row.speakerScore),
                },
              ]}
            />
          </>
        ) : importPending ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
            <Search aria-hidden="true" className="mx-auto size-10 text-zinc-400" />
            <h2 className="mt-4 text-xl font-semibold text-zinc-950">
              Import in progress
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-600">
              The scraper is starting from the form above. Status updates will appear there while
              data is loaded into PostgreSQL.
            </p>
          </section>
        ) : (
          <section className="rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
            <Search aria-hidden="true" className="mx-auto size-10 text-zinc-400" />
            <h2 className="mt-4 text-xl font-semibold text-zinc-950">
              No tournament data found
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-600">
              Run the scraper against a Tabbycat tournament, then refresh this page to inspect
              the imported backend data.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
