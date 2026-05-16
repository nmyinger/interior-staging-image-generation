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

  await sql`
    CREATE TABLE IF NOT EXISTS generation_history (
      id         TEXT PRIMARY KEY,
      node_id    TEXT NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      output_b64 TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS generation_history_node_idx ON generation_history(node_id)`;

  // Sharing: link access controls + per-user invite list
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS link_access TEXT NOT NULL DEFAULT 'private'`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS share_password_hash TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS session_invites (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      email      TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, email)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS session_invites_session_idx ON session_invites(session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS session_invites_email_idx ON session_invites(email)`;

  // Blob storage: user-scoped photos + URL columns
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS image_url TEXT`;
  await sql`ALTER TABLE photos ALTER COLUMN image_b64 DROP NOT NULL`;
  await sql`ALTER TABLE photos ALTER COLUMN image_b64 SET DEFAULT ''`;
  await sql`CREATE INDEX IF NOT EXISTS photos_user_idx ON photos(user_id)`;

  // generation_history: add output_url for blob-stored outputs
  await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS output_url TEXT`;
  await sql`ALTER TABLE generation_history ALTER COLUMN output_b64 DROP NOT NULL`;
  await sql`ALTER TABLE generation_history ALTER COLUMN output_b64 SET DEFAULT ''`;

  // -------------------------------------------------------------------------
  // New columns on existing tables (SaaS expansion)
  // -------------------------------------------------------------------------
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_org_id TEXT NULL`;
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS org_id TEXT NULL`;
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS sha256 TEXT NULL`;
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS original_url TEXT NULL`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS org_id TEXT NULL`;

  // -------------------------------------------------------------------------
  // Tenancy
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS orgs (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL CHECK (type IN ('solo', 'studio', 'brokerage')),
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL,
      parent_org_id TEXT NULL REFERENCES orgs(id),
      brand         JSONB NOT NULL DEFAULT '{}',
      settings      JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT orgs_slug_unique UNIQUE (slug)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS org_members (
      id         TEXT PRIMARY KEY,
      org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'client')),
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT org_members_org_user_unique UNIQUE (org_id, user_id)
    )
  `;

  // -------------------------------------------------------------------------
  // Billing
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      id                     TEXT PRIMARY KEY,
      org_id                 TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      stripe_customer_id     TEXT NULL,
      stripe_subscription_id TEXT NULL,
      tier                   TEXT NOT NULL CHECK (tier IN ('solo', 'studio', 'brokerage')),
      status                 TEXT NOT NULL,
      current_period_start   TIMESTAMPTZ NULL,
      current_period_end     TIMESTAMPTZ NULL,
      seats_purchased        INT NOT NULL DEFAULT 1,
      cancel_at_period_end   BOOL NOT NULL DEFAULT false,
      CONSTRAINT billing_subscriptions_org_unique UNIQUE (org_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS usage_events (
      id                   BIGSERIAL PRIMARY KEY,
      org_id               TEXT NOT NULL REFERENCES orgs(id),
      user_id              TEXT NULL,
      kind                 TEXT NOT NULL CHECK (kind IN ('generation', 'batch_generation')),
      model                TEXT NULL,
      cost_cents           INT NOT NULL DEFAULT 0,
      ref_id               TEXT NULL,
      billing_period_start TIMESTAMPTZ NOT NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS usage_events_org_period_idx ON usage_events (org_id, billing_period_start)`;

  // -------------------------------------------------------------------------
  // Properties & Photos
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS properties (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      client_org_id TEXT NULL REFERENCES orgs(id),
      created_by    TEXT NOT NULL REFERENCES users(id),
      name          TEXT NOT NULL,
      address       TEXT NULL,
      mls           TEXT NULL,
      style_brief   JSONB NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'queued', 'analyzing', 'generating', 'done', 'failed')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Add sessions.property_id FK here (after properties table exists)
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS property_id TEXT NULL REFERENCES properties(id) ON DELETE SET NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS property_photos (
      id             TEXT PRIMARY KEY,
      property_id    TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      photo_filename TEXT NOT NULL REFERENCES photos(filename),
      room_type      TEXT NULL,
      zone           TEXT NULL,
      is_hero        BOOL NOT NULL DEFAULT false,
      position       INT NOT NULL DEFAULT 0
    )
  `;

  // -------------------------------------------------------------------------
  // Batches
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS batches (
      id          TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      org_id      TEXT NOT NULL REFERENCES orgs(id),
      status      TEXT NOT NULL DEFAULT 'queued',
      manifest    JSONB NULL,
      catalog     JSONB NULL,
      model       TEXT NULL,
      started_at  TIMESTAMPTZ NULL,
      finished_at TIMESTAMPTZ NULL,
      error       TEXT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS batch_items (
      id                TEXT PRIMARY KEY,
      batch_id          TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      property_photo_id TEXT NOT NULL REFERENCES property_photos(id),
      status            TEXT NOT NULL DEFAULT 'queued',
      staged_url        TEXT NULL,
      staged_raw_url    TEXT NULL,
      original_url      TEXT NOT NULL DEFAULT '',
      prompt            TEXT NULL,
      error             TEXT NULL,
      started_at        TIMESTAMPTZ NULL,
      finished_at       TIMESTAMPTZ NULL
    )
  `;

  // -------------------------------------------------------------------------
  // Compliance
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS disclosures (
      id               TEXT PRIMARY KEY,
      org_id           TEXT NOT NULL REFERENCES orgs(id),
      property_id      TEXT NULL REFERENCES properties(id) ON DELETE SET NULL,
      batch_item_id    TEXT NULL REFERENCES batch_items(id),
      short_code       TEXT NOT NULL,
      original_url     TEXT NOT NULL,
      staged_url       TEXT NOT NULL,
      mls              TEXT NULL,
      watermark_config JSONB NOT NULL,
      disclosure_text  TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at       TIMESTAMPTZ NULL,
      CONSTRAINT disclosures_short_code_unique UNIQUE (short_code)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS disclosures_org_created_idx ON disclosures (org_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS mls_rules (
      code                  TEXT PRIMARY KEY,
      display_name          TEXT NOT NULL,
      jurisdiction          TEXT NULL,
      watermark             JSONB NOT NULL,
      requires_original_url BOOL NOT NULL DEFAULT false,
      disclosure_text       TEXT NOT NULL,
      version               INT NOT NULL DEFAULT 1,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Seed MLS rules (idempotent — ON CONFLICT DO NOTHING)
  await sql`
    INSERT INTO mls_rules (code, display_name, jurisdiction, watermark, requires_original_url, disclosure_text, version, updated_at)
    VALUES
      ('HAR',      'Houston Association of Realtors',          'Houston, TX',
       '{"text":"Image does not represent actual property as is","position":"south","sizePct":0.025,"opacity":0.85}',
       false, 'This image has been virtually staged. It does not represent the actual condition of the property.', 1, NOW()),
      ('ACTRIS',   'Austin/Central Texas Realty Information Service', 'Austin, TX',
       '{"text":"Virtually Staged","position":"south","sizePct":0.022,"opacity":0.80}',
       true,  'This image has been virtually staged. The original unstaged photograph must be made available upon request.', 1, NOW()),
      ('CA-AB723', 'California AB 723 (Statewide)',             'California',
       '{"text":"Virtually Staged","position":"southeast","sizePct":0.02,"opacity":0.80}',
       true,  'This image has been virtually staged using artificial intelligence. Per California AB 723, a link to the original unstaged photograph is required and must be disclosed in the listing.', 1, NOW()),
      ('WI-ACT69', 'Wisconsin Act 69',                         'Wisconsin',
       '{"text":"Virtually Staged - AI Modified","position":"south","sizePct":0.022,"opacity":0.80}',
       false, 'This image has been virtually staged using artificial intelligence and does not represent the current condition of the property.', 1, NOW()),
      ('CRMLS',    'California Regional MLS',                  'Southern California',
       '{"text":"Virtually Staged","position":"south","sizePct":0.022,"opacity":0.80}',
       true,  'This image has been virtually staged. The original unstaged photograph must be provided alongside this image in the listing.', 1, NOW()),
      ('SDMLS',    'San Diego MLS',                            'San Diego, CA',
       '{"text":"Virtually Staged","position":"southeast","sizePct":0.02,"opacity":0.80}',
       true,  'This image has been virtually staged. The original unstaged photograph must be made available in the listing per SDMLS policy.', 1, NOW()),
      ('BRIGHT',   'Bright MLS',                               'Mid-Atlantic (DC, MD, VA, PA, DE, NJ, WV)',
       '{"text":"Virtually Staged - No Structural Alterations","position":"south","sizePct":0.02,"opacity":0.85}',
       false, 'This image has been virtually staged. No structural alterations have been made to the property. Furniture and decor shown are for illustrative purposes only.', 1, NOW()),
      ('FMLS',     'First Multiple Listing Service',            'Atlanta, GA',
       '{"text":"Virtually Staged","position":"southwest","sizePct":0.02,"opacity":0.80}',
       false, 'This image has been virtually staged and does not represent the current condition or furnishings of the property.', 1, NOW()),
      ('BEACHES',  'Beaches MLS',                              'South Florida (Palm Beach, Broward, St. Lucie)',
       '{"text":"Virtually Staged","position":"southeast","sizePct":0.022,"opacity":0.80}',
       false, 'This image has been virtually staged and is for illustrative purposes only. It does not represent the current condition of the property.', 1, NOW())
    ON CONFLICT (code) DO NOTHING
  `;

  // -------------------------------------------------------------------------
  // API Access
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           TEXT PRIMARY KEY,
      org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES users(id),
      name         TEXT NOT NULL,
      key_prefix   TEXT NOT NULL,
      key_hash     TEXT NOT NULL,
      last_used_at TIMESTAMPTZ NULL,
      scopes       TEXT[] NOT NULL DEFAULT ARRAY['batches:write'],
      revoked_at   TIMESTAMPTZ NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS api_keys_prefix_active_idx ON api_keys (key_prefix) WHERE revoked_at IS NULL`;

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id         TEXT PRIMARY KEY,
      org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      url        TEXT NOT NULL,
      secret     TEXT NOT NULL,
      events     TEXT[] NOT NULL DEFAULT ARRAY['batch.completed'],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id              TEXT PRIMARY KEY,
      endpoint_id     TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
      event           TEXT NOT NULL,
      payload         JSONB NOT NULL,
      status          INT NULL,
      attempts        INT NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NULL,
      delivered_at    TIMESTAMPTZ NULL
    )
  `;

  // -------------------------------------------------------------------------
  // Stripe idempotency
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS stripe_events_processed (
      stripe_event_id TEXT PRIMARY KEY,
      processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // -------------------------------------------------------------------------
  // Unified schema — Phase 0003
  // -------------------------------------------------------------------------
  await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'property' CHECK (kind IN ('property', 'scratch'))`;
  await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS link_access TEXT NOT NULL DEFAULT 'private' CHECK (link_access IN ('private', 'view', 'edit'))`;
  await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS share_password_hash TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS rooms (
      id           TEXT PRIMARY KEY,
      property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      prompt       TEXT NOT NULL DEFAULT '',
      position     INT  NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS rooms_property_idx ON rooms(property_id, position)`;

  await sql`
    CREATE TABLE IF NOT EXISTS assets (
      id            TEXT PRIMARY KEY,
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS assets_property_room_idx ON assets(property_id, room_id, position)`;
  await sql`CREATE INDEX IF NOT EXISTS assets_property_kind_idx ON assets(property_id, kind)`;
  await sql`CREATE INDEX IF NOT EXISTS assets_sha256_idx ON assets(org_id, sha256) WHERE sha256 IS NOT NULL`;

  await sql`ALTER TABLE batches ADD COLUMN IF NOT EXISTS room_id    TEXT NULL REFERENCES rooms(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE batches ADD COLUMN IF NOT EXISTS created_by TEXT NULL REFERENCES users(id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS generations (
      id                   TEXT PRIMARY KEY,
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS generations_property_idx ON generations(property_id)`;
  await sql`CREATE INDEX IF NOT EXISTS generations_source_idx ON generations(source_asset_id)`;
  await sql`CREATE INDEX IF NOT EXISTS generations_batch_seq_idx ON generations(batch_id, sequence_index)`;
  await sql`CREATE INDEX IF NOT EXISTS generations_parent_idx ON generations(parent_generation_id) WHERE parent_generation_id IS NOT NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS generation_inputs (
      generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
      asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      role          TEXT NOT NULL CHECK (role IN ('base', 'reference', 'hero')),
      ord           INT NOT NULL DEFAULT 0,
      PRIMARY KEY (generation_id, asset_id, role)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS generation_inputs_gen_idx ON generation_inputs(generation_id, role, ord)`;

  await sql`
    CREATE TABLE IF NOT EXISTS canvas_layouts (
      property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      entity_kind   TEXT NOT NULL CHECK (entity_kind IN ('asset', 'generation')),
      entity_id     TEXT NOT NULL,
      x             REAL NOT NULL DEFAULT 0,
      y             REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (property_id, entity_kind, entity_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions_legacy (
      session_id   TEXT PRIMARY KEY,
      property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      was_scratch  BOOL NOT NULL DEFAULT false,
      migrated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS asset_inline_data (
      asset_id   TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      mime_type  TEXT NOT NULL,
      data_b64   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}
