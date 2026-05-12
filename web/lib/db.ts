import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";

export const sql = neon(process.env.DATABASE_URL!);

export function genId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      image      TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

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

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL DEFAULT 'Untitled',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // One-time migration from legacy generations/edges to generic canvas_nodes/canvas_edges
  const hasCanvas = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'canvas_nodes' AND table_schema = 'public'
  `;

  if (!hasCanvas.length) {
    await sql`DROP TABLE IF EXISTS edges`;
    await sql`DROP TABLE IF EXISTS generations`;

    await sql`
      CREATE TABLE canvas_nodes (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type       TEXT NOT NULL,
        x          REAL NOT NULL DEFAULT 0,
        y          REAL NOT NULL DEFAULT 0,
        data       JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX canvas_nodes_session     ON canvas_nodes(session_id)`;
    await sql`CREATE INDEX canvas_nodes_session_type ON canvas_nodes(session_id, type)`;

    await sql`
      CREATE TABLE canvas_edges (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        source        TEXT NOT NULL,
        source_handle TEXT NOT NULL DEFAULT 'output',
        target        TEXT NOT NULL,
        target_handle TEXT NOT NULL DEFAULT 'input'
      )
    `;
    await sql`CREATE INDEX canvas_edges_session ON canvas_edges(session_id)`;
  }
}
