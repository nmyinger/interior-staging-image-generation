import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL!);

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS photos (
      filename    TEXT PRIMARY KEY,
      room_type   TEXT NOT NULL DEFAULT 'unknown',
      zone        TEXT NOT NULL DEFAULT 'unknown',
      default_prompt TEXT NOT NULL DEFAULT '',
      image_b64   TEXT NOT NULL,
      mime_type   TEXT NOT NULL DEFAULT 'image/jpeg'
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS generations (
      filename   TEXT PRIMARY KEY,
      prompt     TEXT NOT NULL DEFAULT '',
      output_b64 TEXT,
      node_x     REAL NOT NULL DEFAULT 320,
      node_y     REAL NOT NULL DEFAULT 40,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS edges (
      id            TEXT PRIMARY KEY,
      source_node   TEXT NOT NULL,
      source_handle TEXT,
      target_node   TEXT NOT NULL,
      target_handle TEXT
    )
  `;
}
