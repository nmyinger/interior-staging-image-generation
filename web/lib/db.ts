import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL!);

export async function migrate() {
  // Users — populated on first Google sign-in
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      image      TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Source photos — global (same apartment for everyone)
  await sql`
    CREATE TABLE IF NOT EXISTS photos (
      filename       TEXT PRIMARY KEY,
      room_type      TEXT NOT NULL DEFAULT 'unknown',
      zone           TEXT NOT NULL DEFAULT 'unknown',
      default_prompt TEXT NOT NULL DEFAULT '',
      image_b64      TEXT NOT NULL,
      mime_type      TEXT NOT NULL DEFAULT 'image/jpeg'
    )
  `;

  // Drop old schema if it lacks user_id (dev migration)
  const genHasUser = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'generations' AND column_name = 'user_id'
  `;
  if (!genHasUser.length) {
    await sql`DROP TABLE IF EXISTS edges`;
    await sql`DROP TABLE IF EXISTS generations`;
  }

  // Generations — per user, one row per (user, photo)
  await sql`
    CREATE TABLE IF NOT EXISTS generations (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename   TEXT NOT NULL,
      prompt     TEXT NOT NULL DEFAULT '',
      output_b64 TEXT,
      node_x     REAL NOT NULL DEFAULT 320,
      node_y     REAL NOT NULL DEFAULT 40,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, filename)
    )
  `;

  // Edges — per user, user-drawn reference connections
  await sql`
    CREATE TABLE IF NOT EXISTS edges (
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id            TEXT NOT NULL,
      source_node   TEXT NOT NULL,
      source_handle TEXT,
      target_node   TEXT NOT NULL,
      target_handle TEXT,
      PRIMARY KEY (user_id, id)
    )
  `;
}
