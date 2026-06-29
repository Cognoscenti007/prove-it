import { query } from './index.js';
import { normalizeTournamentUrl, tournamentSlugFromUrl } from '../lib/tabbycat-url.js';

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function mapNumericFields(row, fields) {
  const mapped = { ...row };
  for (const field of fields) {
    mapped[field] = numberOrNull(mapped[field]);
  }
  return mapped;
}

export async function getTournaments() {
  return query(`
    SELECT
      id,
      source_url AS "sourceUrl",
      slug,
      name,
      scraped_at AS "scrapedAt"
    FROM tournaments
    ORDER BY scraped_at DESC, name ASC
  `);
}

export async function getTournamentOverview(tournamentId) {
  const rows = await query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM teams WHERE tournament_id = $1) AS teams,
        (SELECT COUNT(*)::int FROM speakers WHERE tournament_id = $1) AS speakers,
        (SELECT COUNT(*)::int FROM rounds WHERE tournament_id = $1) AS rounds,
        (SELECT COUNT(*)::int FROM debates WHERE tournament_id = $1) AS debates,
        (SELECT COUNT(*)::int FROM motions WHERE tournament_id = $1) AS motions,
        (
          SELECT COUNT(ss.id)::int
          FROM speech_scores ss
          JOIN debate_teams dt ON dt.id = ss.debate_team_id
          JOIN debates d ON d.id = dt.debate_id
          WHERE d.tournament_id = $1
        ) AS speeches,
        (
          SELECT COALESCE(ROUND(AVG(ss.speaker_score)::numeric, 2), 0)
          FROM speech_scores ss
          JOIN debate_teams dt ON dt.id = ss.debate_team_id
          JOIN debates d ON d.id = dt.debate_id
          WHERE d.tournament_id = $1
        ) AS "averageSpeechScore"
    `,
    [tournamentId],
  );

  return rows[0]
    ? mapNumericFields(rows[0], ['averageSpeechScore'])
    : {
        teams: 0,
        speakers: 0,
        rounds: 0,
        debates: 0,
        motions: 0,
        speeches: 0,
        averageSpeechScore: 0,
      };
}

export async function getTournamentBySlug(slug) {
  const rows = await query(
    `
      SELECT
        id,
        source_url AS "sourceUrl",
        slug,
        name,
        scraped_at AS "scrapedAt"
      FROM tournaments
      WHERE slug = $1 OR slug = $2 OR name = $3
      LIMIT 1
    `,
    [slug, slug.startsWith('/') ? slug : `/${slug}`, slug.replace(/^\/+/, '')],
  );

  return rows[0] ?? null;
}

export async function getTournamentByLookup(value) {
  const lookup = String(value ?? '').trim();
  if (!lookup) return null;

  let slug = lookup;
  let normalizedUrl = lookup;

  try {
    normalizedUrl = normalizeTournamentUrl(lookup);
    slug = tournamentSlugFromUrl(lookup);
  } catch {
    slug = lookup.startsWith('/') ? lookup : `/${lookup}`;
  }

  const rows = await query(
    `
      SELECT
        id,
        source_url AS "sourceUrl",
        slug,
        name,
        scraped_at AS "scrapedAt"
      FROM tournaments
      WHERE source_url = $1
         OR source_url = $2
         OR slug = $3
         OR slug = $4
         OR name = $5
      ORDER BY scraped_at DESC
      LIMIT 1
    `,
    [lookup, normalizedUrl, slug, slug.replace(/\/+$/, ''), slug.replace(/^\/+/, '')],
  );

  return rows[0] ?? null;
}

export async function getSpeakersForTournament(tournamentId) {
  return query(
    `
      SELECT
        s.id,
        s.name,
        s.category,
        tm.name AS team,
        str.rank_text AS "rankText",
        str.total_score AS "totalScore",
        str.average_score AS "averageScore",
        str.score_stdev AS "scoreStdev",
        str.debates_count AS "debatesCount"
      FROM speakers s
      LEFT JOIN speaker_tab_results str
        ON str.speaker_id = s.id
       AND str.tournament_id = s.tournament_id
      LEFT JOIN teams tm ON tm.id = str.team_id
      WHERE s.tournament_id = $1
      ORDER BY
        NULLIF(regexp_replace(COALESCE(str.rank_text, ''), '\\D', '', 'g'), '')::int NULLS LAST,
        s.name ASC
    `,
    [tournamentId],
  ).then((rows) =>
    rows.map((row) =>
      mapNumericFields(row, ['totalScore', 'averageScore', 'scoreStdev']),
    ),
  );
}

export async function getParticipantTournamentData(tournamentId, speakerName, teamName = '') {
  const speaker = String(speakerName ?? '').trim();
  const team = String(teamName ?? '').trim();

  if (!speaker) {
    return null;
  }

  const summaryRows = await query(
    `
      SELECT
        s.id,
        s.name,
        s.category,
        tm.name AS team,
        str.rank_text AS "rankText",
        str.total_score AS "totalScore",
        str.average_score AS "averageScore",
        str.score_stdev AS "scoreStdev",
        str.debates_count AS "debatesCount"
      FROM speakers s
      LEFT JOIN speaker_tab_results str
        ON str.speaker_id = s.id
       AND str.tournament_id = s.tournament_id
      LEFT JOIN teams tm ON tm.id = str.team_id
      WHERE s.tournament_id = $1
        AND lower(s.name) = lower($2)
        AND ($3 = '' OR lower(tm.name) = lower($3))
      LIMIT 1
    `,
    [tournamentId, speaker, team],
  );

  if (!summaryRows.length) {
    return null;
  }

  const speakerSummary = mapNumericFields(summaryRows[0], [
    'totalScore',
    'averageScore',
    'scoreStdev',
  ]);

  const rows = await query(
    `
      WITH user_speeches AS (
        SELECT
          d.id AS debate_id,
          d.round_id,
          dt.id AS debate_team_id,
          dt.team_id,
          dt.side_position,
          dt.team_total_score,
          ss.role,
          ss.speaker_score
        FROM speech_scores ss
        JOIN speakers s ON s.id = ss.speaker_id
        JOIN debate_teams dt ON dt.id = ss.debate_team_id
        JOIN teams user_team ON user_team.id = dt.team_id
        JOIN debates d ON d.id = dt.debate_id
        WHERE s.tournament_id = $1
          AND d.tournament_id = $1
          AND lower(s.name) = lower($2)
          AND ($3 = '' OR lower(user_team.name) = lower($3))
      )
      SELECT
        us.debate_id AS "debateId",
        r.name AS round,
        r.round_number AS "roundNumber",
        d.room,
        m.motion_text AS motion,
        user_team.name AS "userTeam",
        us.side_position AS "userSide",
        us.role AS "userRole",
        us.speaker_score AS "speakerScore",
        us.team_total_score AS "userTeamTotal",
        d.adjudicators_text AS adjudicators,
        all_team.id AS "teamId",
        all_team.name AS team,
        all_dt.side_position AS "sidePosition",
        all_dt.team_total_score AS "teamTotalScore",
        trr.position_rank AS "positionRank",
        trr.result_text AS "resultText"
      FROM user_speeches us
      JOIN debates d ON d.id = us.debate_id
      JOIN rounds r ON r.id = d.round_id
      LEFT JOIN motions m ON m.id = d.motion_id
      JOIN teams user_team ON user_team.id = us.team_id
      JOIN debate_teams all_dt ON all_dt.debate_id = d.id
      JOIN teams all_team ON all_team.id = all_dt.team_id
      LEFT JOIN team_round_results trr
        ON trr.team_id = all_team.id
       AND trr.round_id = d.round_id
      ORDER BY r.round_number ASC NULLS LAST, all_dt.side_position ASC, all_team.name ASC
    `,
    [tournamentId, speaker, team],
  );

  const roundsByDebate = new Map();

  for (const row of rows) {
    const debateId = row.debateId;
    if (!roundsByDebate.has(debateId)) {
      roundsByDebate.set(debateId, {
        debateId,
        round: row.round,
        roundNumber: row.roundNumber,
        room: row.room,
        motion: row.motion,
        userTeam: row.userTeam,
        userSide: row.userSide,
        userRole: row.userRole,
        speakerScore: numberOrNull(row.speakerScore),
        userTeamTotal: numberOrNull(row.userTeamTotal),
        adjudicators: row.adjudicators,
        teams: [],
      });
    }

    roundsByDebate.get(debateId).teams.push({
      teamId: row.teamId,
      team: row.team,
      sidePosition: row.sidePosition,
      teamTotalScore: numberOrNull(row.teamTotalScore),
      positionRank: row.positionRank,
      resultText: row.resultText,
    });
  }

  return {
    speaker: speakerSummary,
    rounds: [...roundsByDebate.values()],
  };
}

export async function getSpeakerByName(tournamentSlug, speakerName) {
  const rows = await query(
    `
      SELECT
        s.id,
        s.name,
        s.category,
        t.id AS "tournamentId",
        t.slug AS "tournamentSlug",
        tm.name AS team,
        str.rank_text AS "rankText",
        str.total_score AS "totalScore",
        str.average_score AS "averageScore",
        str.score_stdev AS "scoreStdev",
        str.debates_count AS "debatesCount"
      FROM speakers s
      JOIN tournaments t ON t.id = s.tournament_id
      LEFT JOIN speaker_tab_results str
        ON str.speaker_id = s.id
       AND str.tournament_id = s.tournament_id
      LEFT JOIN teams tm ON tm.id = str.team_id
      WHERE (t.slug = $1 OR t.slug = $2 OR t.name = $3)
        AND lower(s.name) = lower($4)
      LIMIT 1
    `,
    [
      tournamentSlug,
      tournamentSlug.startsWith('/') ? tournamentSlug : `/${tournamentSlug}`,
      tournamentSlug.replace(/^\/+/, ''),
      speakerName,
    ],
  );

  return rows[0] ? mapNumericFields(rows[0], ['totalScore', 'averageScore', 'scoreStdev']) : null;
}

export async function getSpeakerRoundScores(tournamentSlug, speakerId) {
  return query(
    `
      SELECT
        r.id AS "roundId",
        r.name AS round,
        r.round_number AS "roundNumber",
        tm.name AS team,
        srs.speaker_score AS "tabScore",
        d.room,
        dt.side_position AS "sidePosition",
        ss.role,
        ss.speaker_score AS "speechScore",
        dt.team_total_score AS "teamTotalScore",
        d.adjudicators_text AS adjudicators
      FROM speakers s
      JOIN tournaments t ON t.id = s.tournament_id
      JOIN speaker_round_scores srs ON srs.speaker_id = s.id
      JOIN rounds r ON r.id = srs.round_id
      LEFT JOIN teams tm ON tm.id = srs.team_id
      LEFT JOIN speech_scores ss ON ss.speaker_id = s.id
      LEFT JOIN debate_teams dt ON dt.id = ss.debate_team_id
      LEFT JOIN debates d
        ON d.id = dt.debate_id
       AND d.round_id = r.id
       AND d.tournament_id = t.id
      WHERE (t.slug = $1 OR t.slug = $2 OR t.name = $3)
        AND s.id = $4
      ORDER BY r.round_number ASC NULLS LAST, r.name ASC
    `,
    [
      tournamentSlug,
      tournamentSlug.startsWith('/') ? tournamentSlug : `/${tournamentSlug}`,
      tournamentSlug.replace(/^\/+/, ''),
      speakerId,
    ],
  ).then((rows) =>
    rows.map((row) =>
      mapNumericFields(row, ['tabScore', 'speechScore', 'teamTotalScore']),
    ),
  );
}

export async function getTeamTabResults(tournamentId) {
  return query(
    `
      SELECT
        tm.id,
        tm.name,
        tm.category,
        ttr.rank_text AS "rankText",
        ttr.points,
        ttr.speaker_score AS "speakerScore",
        ttr.firsts,
        ttr.seconds,
        ttr.draw_strength AS "drawStrength"
      FROM team_tab_results ttr
      JOIN teams tm ON tm.id = ttr.team_id
      WHERE ttr.tournament_id = $1
      ORDER BY
        NULLIF(regexp_replace(COALESCE(ttr.rank_text, ''), '\\D', '', 'g'), '')::int NULLS LAST,
        tm.name ASC
    `,
    [tournamentId],
  ).then((rows) =>
    rows.map((row) =>
      mapNumericFields(row, ['points', 'speakerScore', 'drawStrength']),
    ),
  );
}

export async function getDebateHistoryByRound(tournamentId, roundNumber) {
  const params = [tournamentId];
  const roundFilter = roundNumber ? 'AND r.round_number = $2' : '';
  if (roundNumber) params.push(roundNumber);

  return query(
    `
      SELECT
        d.id AS "debateId",
        r.name AS round,
        r.round_number AS "roundNumber",
        d.room,
        m.motion_text AS motion,
        dt.side_position AS "sidePosition",
        tm.name AS team,
        dt.team_total_score AS "teamTotalScore",
        s.name AS speaker,
        ss.role,
        ss.speaker_score AS "speakerScore",
        d.adjudicators_text AS adjudicators
      FROM debates d
      JOIN rounds r ON r.id = d.round_id
      LEFT JOIN motions m ON m.id = d.motion_id
      JOIN debate_teams dt ON dt.debate_id = d.id
      JOIN teams tm ON tm.id = dt.team_id
      JOIN speech_scores ss ON ss.debate_team_id = dt.id
      JOIN speakers s ON s.id = ss.speaker_id
      WHERE d.tournament_id = $1
      ${roundFilter}
      ORDER BY r.round_number ASC NULLS LAST, d.room ASC, dt.side_position ASC, ss.role ASC
    `,
    params,
  ).then((rows) =>
    rows.map((row) =>
      mapNumericFields(row, ['teamTotalScore', 'speakerScore']),
    ),
  );
}

export async function getBreakResults(tournamentId, breakCategory = null) {
  const params = [tournamentId];
  const categoryFilter = breakCategory ? 'AND tb.break_category = $2' : '';
  if (breakCategory) params.push(breakCategory);

  return query(
    `
      SELECT
        tb.break_category AS "breakCategory",
        tb.rank,
        tb.break_position AS "breakPosition",
        tm.id AS "teamId",
        tm.name AS team,
        tm.category,
        tb.points,
        tb.speaker_score AS "speakerScore",
        tb.firsts,
        tb.seconds,
        tb.draw_strength AS "drawStrength"
      FROM team_breaks tb
      JOIN teams tm ON tm.id = tb.team_id
      WHERE tb.tournament_id = $1
      ${categoryFilter}
      ORDER BY tb.break_category ASC, tb.rank ASC NULLS LAST, tm.name ASC
    `,
    params,
  ).then((rows) =>
    rows.map((row) =>
      mapNumericFields(row, ['points', 'speakerScore', 'drawStrength']),
    ),
  );
}
