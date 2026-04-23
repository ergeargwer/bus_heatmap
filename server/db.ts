import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stations (
      uid TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      city TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routes (
      uid TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      city TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_shapes (
      uid TEXT PRIMARY KEY REFERENCES routes(uid) ON DELETE CASCADE,
      geometry JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      synced_at TIMESTAMPTZ DEFAULT NOW(),
      stations_count INT,
      routes_count INT,
      status TEXT
    );
  `);

  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`).catch(() => {
    console.warn('[db] pg_trgm not available, LIKE search will still work without GIN index');
  });

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_stations_name ON stations USING gin(name_zh gin_trgm_ops);
  `).catch(() => {
    console.warn('[db] gin index on stations skipped (pg_trgm unavailable)');
  });
}
