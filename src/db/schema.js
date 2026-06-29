import {
  boolean,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const tournaments = pgTable('tournaments', {
  id: serial('id').primaryKey(),
  sourceUrl: text('source_url').notNull().unique(),
  slug: text('slug').notNull(),
  name: text('name'),
  scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull(),
});

export const rounds = pgTable(
  'rounds',
  {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number'),
    name: text('name').notNull(),
  },
  (table) => [unique().on(table.tournamentId, table.name)],
);

export const teams = pgTable(
  'teams',
  {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category'),
  },
  (table) => [unique().on(table.tournamentId, table.name)],
);

export const speakers = pgTable(
  'speakers',
  {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category'),
  },
  (table) => [unique().on(table.tournamentId, table.name)],
);

export const teamSpeakers = pgTable(
  'team_speakers',
  {
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    speakerId: integer('speaker_id').notNull().references(() => speakers.id, { onDelete: 'cascade' }),
    speakerOrder: integer('speaker_order'),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.speakerId] })],
);

export const teamTabResults = pgTable(
  'team_tab_results',
  {
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    rankText: text('rank_text'),
    points: numeric('points', { precision: 6, scale: 2 }),
    speakerScore: numeric('speaker_score', { precision: 8, scale: 2 }),
    firsts: integer('firsts'),
    seconds: integer('seconds'),
    drawStrength: numeric('draw_strength', { precision: 8, scale: 2 }),
  },
  (table) => [primaryKey({ columns: [table.tournamentId, table.teamId] })],
);

export const teamRoundResults = pgTable(
  'team_round_results',
  {
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    roundId: integer('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
    positionRank: integer('position_rank'),
    teamScore: numeric('team_score', { precision: 8, scale: 2 }),
    resultText: text('result_text'),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.roundId] })],
);

export const speakerTabResults = pgTable(
  'speaker_tab_results',
  {
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    speakerId: integer('speaker_id').notNull().references(() => speakers.id, { onDelete: 'cascade' }),
    teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
    rankText: text('rank_text'),
    totalScore: numeric('total_score', { precision: 8, scale: 2 }),
    averageScore: numeric('average_score', { precision: 6, scale: 2 }),
    scoreStdev: numeric('score_stdev', { precision: 6, scale: 2 }),
    debatesCount: integer('debates_count'),
  },
  (table) => [primaryKey({ columns: [table.tournamentId, table.speakerId] })],
);

export const speakerRoundScores = pgTable(
  'speaker_round_scores',
  {
    speakerId: integer('speaker_id').notNull().references(() => speakers.id, { onDelete: 'cascade' }),
    teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
    roundId: integer('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
    speakerScore: numeric('speaker_score', { precision: 6, scale: 2 }),
  },
  (table) => [primaryKey({ columns: [table.speakerId, table.roundId] })],
);

export const motions = pgTable(
  'motions',
  {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    roundId: integer('round_id').references(() => rounds.id, { onDelete: 'set null' }),
    motionText: text('motion_text').notNull(),
    infoSlide: text('info_slide'),
    govAvgPoints: numeric('gov_avg_points', { precision: 6, scale: 2 }),
    oppAvgPoints: numeric('opp_avg_points', { precision: 6, scale: 2 }),
    openingAvgPoints: numeric('opening_avg_points', { precision: 6, scale: 2 }),
    closingAvgPoints: numeric('closing_avg_points', { precision: 6, scale: 2 }),
    ogAvgPoints: numeric('og_avg_points', { precision: 6, scale: 2 }),
    ooAvgPoints: numeric('oo_avg_points', { precision: 6, scale: 2 }),
    cgAvgPoints: numeric('cg_avg_points', { precision: 6, scale: 2 }),
    coAvgPoints: numeric('co_avg_points', { precision: 6, scale: 2 }),
  },
  (table) => [unique().on(table.tournamentId, table.motionText)],
);

export const debates = pgTable(
  'debates',
  {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    roundId: integer('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
    motionId: integer('motion_id').references(() => motions.id, { onDelete: 'set null' }),
    room: text('room').notNull(),
    adjudicatorsText: text('adjudicators_text'),
  },
  (table) => [unique().on(table.tournamentId, table.roundId, table.room)],
);

export const debateTeams = pgTable(
  'debate_teams',
  {
    id: serial('id').primaryKey(),
    debateId: integer('debate_id').notNull().references(() => debates.id, { onDelete: 'cascade' }),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    sidePosition: text('side_position').notNull(),
    teamTotalScore: numeric('team_total_score', { precision: 8, scale: 2 }),
  },
  (table) => [unique().on(table.debateId, table.teamId, table.sidePosition)],
);

export const speechScores = pgTable(
  'speech_scores',
  {
    id: serial('id').primaryKey(),
    debateTeamId: integer('debate_team_id').notNull().references(() => debateTeams.id, { onDelete: 'cascade' }),
    speakerId: integer('speaker_id').notNull().references(() => speakers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    speakerScore: numeric('speaker_score', { precision: 6, scale: 2 }),
  },
  (table) => [unique().on(table.debateTeamId, table.speakerId, table.role)],
);

export const adjudicators = pgTable(
  'adjudicators',
  {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    institution: text('institution'),
    isAdjCore: boolean('is_adj_core'),
    isIndependent: boolean('is_independent'),
  },
  (table) => [unique().on(table.tournamentId, table.name)],
);

export const debateAdjudicators = pgTable(
  'debate_adjudicators',
  {
    debateId: integer('debate_id').notNull().references(() => debates.id, { onDelete: 'cascade' }),
    adjudicatorId: integer('adjudicator_id').notNull().references(() => adjudicators.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.debateId, table.adjudicatorId] })],
);

export const teamBreaks = pgTable(
  'team_breaks',
  {
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
    breakCategory: text('break_category').notNull(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    rank: integer('rank'),
    breakPosition: text('break_position'),
    points: numeric('points', { precision: 6, scale: 2 }),
    speakerScore: numeric('speaker_score', { precision: 8, scale: 2 }),
    firsts: integer('firsts'),
    seconds: integer('seconds'),
    drawStrength: numeric('draw_strength', { precision: 8, scale: 2 }),
  },
  (table) => [primaryKey({ columns: [table.tournamentId, table.breakCategory, table.teamId] })],
);
