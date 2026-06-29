import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;

function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? 'postgresql://postgres:SD2628@127.0.0.1:5432/debate_analytics';
}

const globalForDb = globalThis;

export const pool =
  globalForDb.debateAnalyticsPool ??
  new Pool({
    connectionString: getDatabaseUrl(),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.debateAnalyticsPool = pool;
}

export const db = drizzle(pool, { schema });

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}
