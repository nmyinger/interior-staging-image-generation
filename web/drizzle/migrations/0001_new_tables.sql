-- Migration: 0001_new_tables
-- Creates the full SaaS schema for tenancy, billing, batch processing,
-- compliance (AB 723), API access, webhooks, and Stripe idempotency.
-- Run after the existing tables (users, photos, sessions, canvas_*, etc.)
-- are in place via the legacy migrate() function in lib/db.ts.

-- ============================================================
-- Add new columns to existing tables
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS default_org_id TEXT NULL;

ALTER TABLE photos ADD COLUMN IF NOT EXISTS org_id TEXT NULL;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS sha256 TEXT NULL;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS original_url TEXT NULL;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS org_id TEXT NULL;

-- ============================================================
-- TENANCY
-- ============================================================

CREATE TABLE IF NOT EXISTS orgs (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('solo', 'studio', 'brokerage')),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  parent_org_id   TEXT NULL REFERENCES orgs(id),
  brand           JSONB NOT NULL DEFAULT '{}',
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orgs_slug_unique UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS org_members (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'client')),
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_members_org_user_unique UNIQUE (org_id, user_id)
);

-- ============================================================
-- BILLING
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  stripe_customer_id    TEXT NULL,
  stripe_subscription_id TEXT NULL,
  tier                  TEXT NOT NULL CHECK (tier IN ('solo', 'studio', 'brokerage')),
  status                TEXT NOT NULL,
  current_period_start  TIMESTAMPTZ NULL,
  current_period_end    TIMESTAMPTZ NULL,
  seats_purchased       INT NOT NULL DEFAULT 1,
  cancel_at_period_end  BOOL NOT NULL DEFAULT false,
  CONSTRAINT billing_subscriptions_org_unique UNIQUE (org_id)
);

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
);

CREATE INDEX IF NOT EXISTS usage_events_org_period_idx
  ON usage_events (org_id, billing_period_start);

-- ============================================================
-- PROPERTIES & PHOTOS
-- ============================================================

CREATE TABLE IF NOT EXISTS properties (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_org_id  TEXT NULL REFERENCES orgs(id),
  created_by     TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  address        TEXT NULL,
  mls            TEXT NULL,
  style_brief    JSONB NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'queued', 'analyzing', 'generating', 'done', 'failed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_photos (
  id              TEXT PRIMARY KEY,
  property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  photo_filename  TEXT NOT NULL REFERENCES photos(filename),
  room_type       TEXT NULL,
  zone            TEXT NULL,
  is_hero         BOOL NOT NULL DEFAULT false,
  position        INT NOT NULL DEFAULT 0
);

-- ============================================================
-- BATCHES
-- ============================================================

CREATE TABLE IF NOT EXISTS batches (
  id           TEXT PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  org_id       TEXT NOT NULL REFERENCES orgs(id),
  status       TEXT NOT NULL DEFAULT 'queued',
  manifest     JSONB NULL,
  catalog      JSONB NULL,
  model        TEXT NULL,
  started_at   TIMESTAMPTZ NULL,
  finished_at  TIMESTAMPTZ NULL,
  error        TEXT NULL
);

CREATE TABLE IF NOT EXISTS batch_items (
  id                 TEXT PRIMARY KEY,
  batch_id           TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  property_photo_id  TEXT NOT NULL REFERENCES property_photos(id),
  status             TEXT NOT NULL DEFAULT 'queued',
  staged_url         TEXT NULL,
  staged_raw_url     TEXT NULL,
  original_url       TEXT NOT NULL DEFAULT '',
  prompt             TEXT NULL,
  error              TEXT NULL,
  started_at         TIMESTAMPTZ NULL,
  finished_at        TIMESTAMPTZ NULL
);

-- ============================================================
-- COMPLIANCE
-- ============================================================

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
);

CREATE INDEX IF NOT EXISTS disclosures_org_created_idx
  ON disclosures (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mls_rules (
  code                  TEXT PRIMARY KEY,
  display_name          TEXT NOT NULL,
  jurisdiction          TEXT NULL,
  watermark             JSONB NOT NULL,
  requires_original_url BOOL NOT NULL DEFAULT false,
  disclosure_text       TEXT NOT NULL,
  version               INT NOT NULL DEFAULT 1,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- API ACCESS
-- ============================================================

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
);

CREATE INDEX IF NOT EXISTS api_keys_prefix_active_idx
  ON api_keys (key_prefix)
  WHERE revoked_at IS NULL;

-- ============================================================
-- WEBHOOKS
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  secret     TEXT NOT NULL,
  events     TEXT[] NOT NULL DEFAULT ARRAY['batch.completed'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              TEXT PRIMARY KEY,
  endpoint_id     TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          INT NULL,
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NULL,
  delivered_at    TIMESTAMPTZ NULL
);

-- ============================================================
-- STRIPE IDEMPOTENCY
-- ============================================================

CREATE TABLE IF NOT EXISTS stripe_events_processed (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SEED: MLS Rules
-- ============================================================

INSERT INTO mls_rules (code, display_name, jurisdiction, watermark, requires_original_url, disclosure_text, version, updated_at)
VALUES
  (
    'HAR',
    'Houston Association of Realtors',
    'Houston, TX',
    '{"text": "Image does not represent actual property as is", "position": "south", "sizePct": 0.025, "opacity": 0.85}',
    false,
    'This image has been virtually staged. It does not represent the actual condition of the property.',
    1,
    NOW()
  ),
  (
    'ACTRIS',
    'Austin/Central Texas Realty Information Service',
    'Austin, TX',
    '{"text": "Virtually Staged", "position": "south", "sizePct": 0.022, "opacity": 0.80}',
    true,
    'This image has been virtually staged. The original unstaged photograph must be made available upon request.',
    1,
    NOW()
  ),
  (
    'CA-AB723',
    'California AB 723 (Statewide)',
    'California',
    '{"text": "Virtually Staged", "position": "southeast", "sizePct": 0.02, "opacity": 0.80}',
    true,
    'This image has been virtually staged using artificial intelligence. Per California AB 723, a link to the original unstaged photograph is required and must be disclosed in the listing.',
    1,
    NOW()
  ),
  (
    'WI-ACT69',
    'Wisconsin Act 69',
    'Wisconsin',
    '{"text": "Virtually Staged - AI Modified", "position": "south", "sizePct": 0.022, "opacity": 0.80}',
    false,
    'This image has been virtually staged using artificial intelligence and does not represent the current condition of the property.',
    1,
    NOW()
  ),
  (
    'CRMLS',
    'California Regional MLS',
    'Southern California',
    '{"text": "Virtually Staged", "position": "south", "sizePct": 0.022, "opacity": 0.80}',
    true,
    'This image has been virtually staged. The original unstaged photograph must be provided alongside this image in the listing.',
    1,
    NOW()
  ),
  (
    'SDMLS',
    'San Diego MLS',
    'San Diego, CA',
    '{"text": "Virtually Staged", "position": "southeast", "sizePct": 0.02, "opacity": 0.80}',
    true,
    'This image has been virtually staged. The original unstaged photograph must be made available in the listing per SDMLS policy.',
    1,
    NOW()
  ),
  (
    'BRIGHT',
    'Bright MLS',
    'Mid-Atlantic (DC, MD, VA, PA, DE, NJ, WV)',
    '{"text": "Virtually Staged - No Structural Alterations", "position": "south", "sizePct": 0.02, "opacity": 0.85}',
    false,
    'This image has been virtually staged. No structural alterations have been made to the property. Furniture and decor shown are for illustrative purposes only.',
    1,
    NOW()
  ),
  (
    'FMLS',
    'First Multiple Listing Service',
    'Atlanta, GA',
    '{"text": "Virtually Staged", "position": "southwest", "sizePct": 0.02, "opacity": 0.80}',
    false,
    'This image has been virtually staged and does not represent the current condition or furnishings of the property.',
    1,
    NOW()
  ),
  (
    'BEACHES',
    'Beaches MLS',
    'South Florida (Palm Beach, Broward, St. Lucie)',
    '{"text": "Virtually Staged", "position": "southeast", "sizePct": 0.022, "opacity": 0.80}',
    false,
    'This image has been virtually staged and is for illustrative purposes only. It does not represent the current condition of the property.',
    1,
    NOW()
  )
ON CONFLICT (code) DO NOTHING;
