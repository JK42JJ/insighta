import pg from 'pg';
import pgvector from 'pgvector/pg';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL'] ??
      `postgresql://postgres:${process.env['POSTGRES_PASSWORD'] ?? 'postgres'}@127.0.0.1:5432/postgres`;

    pool = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export async function initDb(): Promise<void> {
  const client = await getPool().connect();
  try {
    await pgvector.registerTypes(client);
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
