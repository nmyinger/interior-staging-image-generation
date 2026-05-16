-- Migration: 0003_unified_schema
-- Introduces the unified asset/generation/canvas model.
-- All new tables are additive — old tables remain until 0005_drop_legacy.sql.
-- Run this BEFORE 0004_backfill.sql.

-- ---------------------------------------------------------------------------
-- Extend properties with canvas-sharing fields + kind discriminator
-- ---------------------------------------------------------------------------
ALTER TABLE properties ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'property'
  CHECK (kind IN ('property', 'scratch'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS link_access TEXT NOT NULL DEFAULT 'private'
  CHECK (link_access IN ('private', 'view', 'edit'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS share_password_hash TEXT;

-- ---------------------------------------------------------------------------
-- rooms — replaces property_rooms (same shape, cleaner name)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id           TEXT PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prompt       TEXT NOT NULL DEFAULT '',
  position     INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rooms_property_idx ON rooms(property_id, position);

-- ---------------------------------------------------------------------------
-- assets — unified image table (source uploads + AI outputs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,                  -- 'ast_xxx'
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  property_id   TEXT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_id       TEXT NULL REFERENCES rooms(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('source', 'staged')),
  sha256        TEXT NULL,
  mime_type     TEXT NOT NULL DEFAULT 'image/jpeg',
  width         INT NULL,
  height        INT NULL,
  blob_url      TEXT NOT NULL,
  original_url  TEXT NULL,
  position      INT NOT NULL DEFAULT 0,
  is_hero       BOOL NOT NULL DEFAULT false,
  zone          TEXT NULL,
  room_type     TEXT NULL,
  uploaded_by   TEXT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assets_property_room_idx ON assets(property_id, room_id, position);
CREATE INDEX IF NOT EXISTS assets_property_kind_idx ON assets(property_id, kind);
CREATE INDEX IF NOT EXISTS assets_sha256_idx ON assets(org_id, sha256) WHERE sha256 IS NOT NULL;

-- ---------------------------------------------------------------------------
-- generations — one row per AI call (replaces batch_items + canvas generation nodes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generations (
  id                   TEXT PRIMARY KEY,           -- 'gen_xxx'
  org_id               TEXT NOT NULL REFERENCES orgs(id),
  property_id          TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_id              TEXT NULL REFERENCES rooms(id) ON DELETE SET NULL,
  source_asset_id      TEXT NULL REFERENCES assets(id) ON DELETE SET NULL,
  output_asset_id      TEXT NULL REFERENCES assets(id) ON DELETE SET NULL,
  prompt               TEXT NOT NULL DEFAULT '',
  model                TEXT NULL,
  config               JSONB NOT NULL DEFAULT '{}',
  parent_generation_id TEXT NULL REFERENCES generations(id) ON DELETE SET NULL,
  batch_id             TEXT NULL REFERENCES batches(id) ON DELETE SET NULL,
  sequence_index       INT NULL,
  status               TEXT NOT NULL DEFAULT 'idle'
                         CHECK (status IN ('idle', 'queued', 'running', 'done', 'failed')),
  error                TEXT NULL,
  started_at           TIMESTAMPTZ NULL,
  finished_at          TIMESTAMPTZ NULL,
  created_by           TEXT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS generations_property_idx ON generations(property_id);
CREATE INDEX IF NOT EXISTS generations_source_idx ON generations(source_asset_id);
CREATE INDEX IF NOT EXISTS generations_batch_seq_idx ON generations(batch_id, sequence_index);
CREATE INDEX IF NOT EXISTS generations_parent_idx ON generations(parent_generation_id) WHERE parent_generation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- generation_inputs — typed edges (replaces canvas_edges + implicit hero refs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generation_inputs (
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('base', 'reference', 'hero')),
  ord           INT NOT NULL DEFAULT 0,
  PRIMARY KEY (generation_id, asset_id, role)
);
CREATE INDEX IF NOT EXISTS generation_inputs_gen_idx ON generation_inputs(generation_id, role, ord);

-- ---------------------------------------------------------------------------
-- canvas_layouts — x/y positions per entity (pure UI overlay)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canvas_layouts (
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  entity_kind   TEXT NOT NULL CHECK (entity_kind IN ('asset', 'generation')),
  entity_id     TEXT NOT NULL,
  x             REAL NOT NULL DEFAULT 0,
  y             REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, entity_kind, entity_id)
);

-- ---------------------------------------------------------------------------
-- sessions_legacy — maps old session_id → property_id for redirects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions_legacy (
  session_id   TEXT PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  was_scratch  BOOL NOT NULL DEFAULT false,
  migrated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- asset_inline_data — dev fallback when Blob is not configured
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_inline_data (
  asset_id   TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  mime_type  TEXT NOT NULL,
  data_b64   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Add batches.room_id + batches.created_by (needed by new pipeline)
-- ---------------------------------------------------------------------------
ALTER TABLE batches ADD COLUMN IF NOT EXISTS room_id    TEXT NULL REFERENCES rooms(id) ON DELETE SET NULL;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS created_by TEXT NULL REFERENCES users(id);
