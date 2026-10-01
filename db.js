/**
 * Postgres store backed by Neon (DATABASE_URL). Same interface as the
 * in-memory store used by tests.
 */
const { Pool } = require('pg');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  p1_discord_id TEXT NOT NULL,
  p1_username TEXT NOT NULL,
  p1_elo INTEGER NOT NULL,
  p1_peak INTEGER NOT NULL,
  p2_discord_id TEXT NOT NULL,
  p2_username TEXT NOT NULL,
  p2_elo INTEGER NOT NULL,
  p2_peak INTEGER NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brackets (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL
);
`;

/**
 * Point the pool at Neon's pooled endpoint when running on serverless (Vercel).
 * Only the host changes: `-pooler` is inserted into the endpoint id (ep-xxxx),
 * and the port is left as supplied — Neon's pooled endpoint is reached on 5432;
 * 6543 is not reachable on current Neon endpoints.
 *   ep-abc.c-4.us-east-1.aws.neon.tech -> ep-abc-pooler.c-4.us-east-1.aws.neon.tech
 * A URL that already says -pooler is left alone. Local dev is unchanged.
 */
function pooledConnectionString(conn) {
  if (!process.env.VERCEL || !conn || !conn.includes('.neon.tech')) return conn;
  return conn.replace(/@((ep-[^.@:]+?)(?:-pooler)?)\./i, '@$2-pooler.');
}

function createPostgresStore(databaseUrl) {
  const pool = new Pool({
    connectionString: pooledConnectionString(databaseUrl),
    max: Number(process.env.PGPOOL_MAX || 5), // per-lambda cap on serverless
  });

  return {
    pool,
    async init() {
      await pool.query(SCHEMA);
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('registration_open', 'true')
         ON CONFLICT (key) DO NOTHING`
      );
    },
    async getTeams() {
      const { rows } = await pool.query('SELECT * FROM teams ORDER BY id');
      return rows.map(rowToTeam);
    },
    async getTeam(id) {
      const { rows } = await pool.query('SELECT * FROM teams WHERE id = $1', [id]);
      return rows[0] ? rowToTeam(rows[0]) : null;
    },
    async insertTeam(team) {
      const { rows } = await pool.query(
        `INSERT INTO teams
         (p1_discord_id, p1_username, p1_elo, p1_peak,
          p2_discord_id, p2_username, p2_elo, p2_peak)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          team.p1.discordId, team.p1.username, team.p1.elo, team.p1.peak,
          team.p2.discordId, team.p2.username, team.p2.elo, team.p2.peak,
        ]
      );
      return rowToTeam(rows[0]);
    },
    async deleteTeam(id) {
      const { rowCount } = await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return rowCount > 0;
    },
    async getRegistrationOpen() {
      const { rows } = await pool.query(
        `SELECT value FROM settings WHERE key = 'registration_open'`
      );
      return rows[0] ? rows[0].value === 'true' : true;
    },
    async setRegistrationOpen(open) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('registration_open', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [String(open)]
      );
    },
    async getTournamentStart() {
      const { rows } = await pool.query(
        `SELECT value FROM settings WHERE key = 'tournament_start'`
      );
      return rows[0] ? rows[0].value : null;
    },
    async setTournamentStart(iso) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('tournament_start', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [iso]
      );
    },
    async getSetting(key) {
      const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
      return rows[0] ? rows[0].value : null;
    },
    async setSetting(key, value) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, value]
      );
    },
    async getBracket() {
      const { rows } = await pool.query('SELECT data FROM brackets WHERE id = 1');
      return rows[0] ? rows[0].data : null;
    },
    async saveBracket(data) {
      await pool.query(
        `INSERT INTO brackets (id, data) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET data = $1`,
        [JSON.stringify(data)]
      );
    },
    async clearBracket() {
      await pool.query('DELETE FROM brackets WHERE id = 1');
    },
  };
}

function rowToTeam(r) {
  return {
    id: r.id,
    p1: {
      discordId: r.p1_discord_id,
      username: r.p1_username,
      elo: r.p1_elo,
      peak: r.p1_peak,
    },
    p2: {
      discordId: r.p2_discord_id,
      username: r.p2_username,
      elo: r.p2_elo,
      peak: r.p2_peak,
    },
    registeredAt: r.registered_at,
  };
}

module.exports = { createPostgresStore };
