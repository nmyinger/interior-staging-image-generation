# Virtual Staging SaaS — Product Requirements Document

**Version:** 2.0 | **Date:** May 2026
**Status:** Active — supersedes original pipeline-focused PRD

---

## Vision

A compliance-grade AI virtual staging platform built for real estate photographers and brokerages — not a generic staging tool. The differentiators are batch-by-property workflow (entire shoots processed as one job with consistent furniture across all rooms), structural integrity (AI never hallucinate windows or alter room architecture), and automatic AB 723 disclosure compliance (watermark + permanent original-photo URL generated on every image). The business model is B2B2C: photographers buy the Studio plan and resell staged images to their agent clients at 70%+ margin.

This is not a horizontal consumer staging tool. It is a professional workflow product for people whose business depends on listing photos being both visually compelling and legally compliant.

---

## Market Context (summarized from research)

The market has two structural facts that shape every product decision:

1. **Zillow owns the dominant channel.** Aryeo (their photography CRM, ~40-50% of the pro photographer market) now bundles VirtualStagingAI free. Competing there is competing against infinite free. The target is the ~50-60% of photographers using Spiro, HDPhotoHub, or no CRM — they have no free staging.

2. **A compliance crisis is live.** California AB 723 (effective January 1, 2026) requires every virtually staged image to include a disclosure watermark AND a permanent public URL to the original unaltered photo. Wisconsin has a similar law. 15+ MLS boards have specific watermark rules. No current staging tool generates the required original-photo URL automatically. This creates an acquisition wedge among photographers who deliver staged images to agents (who hold the liability).

**ICPs in priority order:**
1. Non-Aryeo real estate photographers (Studio tier, $149/mo) — primary wedge
2. 5–50 agent brokerages (Brokerage tier, $399/mo) — fastest path to $50K MRR
3. Individual agents (Solo tier, $39/mo) — inbound/organic only, not the marketing focus

---

## Development Philosophy

**Never build from scratch.** For every feature, look for an existing library, open-source solution, or SaaS that handles it first. The best code is the code that doesn't exist. Evaluate build-vs-buy on: days to ship, maintenance burden, and whether it's differentiated (if competitors have it, it's commodity and you should buy it).

**Ship the smallest useful thing per ICP, in sequence.** Don't build Phase 4 before Phase 1 has paying customers. Each phase should be usable and monetizable before the next begins.

---

## Tech Stack

| Layer | Current | Change |
|---|---|---|
| Framework | Next.js 16 App Router | No change |
| React | 19.2.4 | No change |
| Canvas | @xyflow/react v12 | No change (Solo ICP surface) |
| Auth | next-auth v4 (Google OAuth) | Migrate to Clerk v6 (adds orgs, invites, email/pw) |
| Database | Neon serverless Postgres | No change; add Drizzle ORM + drizzle-kit migrations |
| ORM | Hand-written SQL with `sql` tag | Adopt drizzle-orm — typed queries, safer migrations |
| AI | @google/genai v2 | No change |
| Async jobs | None (synchronous API route) | Add Inngest — step-function durability for batch jobs |
| Storage | @vercel/blob | No change; add key pattern for compliance originals |
| Styles | Tailwind v4 + shadcn | No change |
| Image processing | sharp | No change; extend for watermarking |
| Billing | None | stripe-node + Stripe Customer Portal |
| Rate limiting | None | @upstash/ratelimit + Upstash Redis |
| Input validation | Ad-hoc | Zod on all API routes |
| Transactional email | None | Resend |
| Newsletter + lifecycle | None | Loops.so |
| PDF generation | None | @react-pdf/renderer (compliance export) |
| QR codes | None | qrcode (server-side, tiny) |
| Observability | None | Sentry + Vercel OpenTelemetry |

---

## Schema

### Existing tables (extended)

```sql
-- Add to users:
ALTER TABLE users ADD COLUMN password_hash TEXT NULL;       -- for email/pw auth (Clerk handles this)
ALTER TABLE users ADD COLUMN default_org_id TEXT NULL;

-- Add to photos:
ALTER TABLE photos ADD COLUMN org_id TEXT NULL;             -- backfilled from user_id
ALTER TABLE photos ADD COLUMN sha256 TEXT NULL;             -- dedup on upload
ALTER TABLE photos ADD COLUMN original_url TEXT NULL;       -- compliance copy (immutable)

-- Add to sessions:
ALTER TABLE sessions ADD COLUMN org_id TEXT NULL;           -- backfilled from owner_user_id
```

### New tables

```sql
-- Tenancy
CREATE TABLE orgs (
  id             TEXT PRIMARY KEY,                          -- 'org_xxx'
  type           TEXT NOT NULL,                             -- 'solo' | 'studio' | 'brokerage'
  name           TEXT NOT NULL,
  slug           TEXT UNIQUE NOT NULL,                      -- for white-label paths
  parent_org_id  TEXT NULL REFERENCES orgs(id) ON DELETE SET NULL,  -- sub-accounts
  brand          JSONB NOT NULL DEFAULT '{}',               -- { logoUrl, primaryColor, watermarkText }
  settings       JSONB NOT NULL DEFAULT '{}',               -- { defaultModel, defaultMls, ... }
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE org_members (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,                                -- 'owner' | 'admin' | 'member' | 'client'
  status      TEXT NOT NULL DEFAULT 'active',              -- 'active' | 'invited' | 'disabled'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

-- Billing
CREATE TABLE billing_subscriptions (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT NOT NULL,
  stripe_subscription_id  TEXT NULL,
  tier                    TEXT NOT NULL,                    -- 'solo' | 'studio' | 'brokerage'
  status                  TEXT NOT NULL,                   -- 'active' | 'past_due' | 'canceled' | 'trialing'
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  seats_purchased         INT NOT NULL DEFAULT 1,
  cancel_at_period_end    BOOL NOT NULL DEFAULT FALSE,
  UNIQUE (org_id)
);

CREATE TABLE usage_events (
  id                    BIGSERIAL PRIMARY KEY,
  org_id                TEXT NOT NULL REFERENCES orgs(id),
  user_id               TEXT NULL,
  kind                  TEXT NOT NULL,                      -- 'generation' | 'batch_generation'
  model                 TEXT,
  cost_cents            INT NOT NULL DEFAULT 0,             -- our API cost, for margin tracking
  ref_id                TEXT,                               -- node_id or batch_item_id
  billing_period_start  TIMESTAMPTZ NOT NULL,               -- denormalized for fast rollups
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX usage_events_org_period ON usage_events(org_id, billing_period_start);

-- Property batches (photographer ICP)
CREATE TABLE properties (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_org_id   TEXT NULL REFERENCES orgs(id),           -- sub-account this is staged for
  created_by      TEXT NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,                            -- "123 Main St"
  address         TEXT,
  mls             TEXT,                                     -- 'HAR' | 'ACTRIS' | etc.
  style_brief     JSONB NOT NULL DEFAULT '{}',             -- { style, palette, notes }
  status          TEXT NOT NULL DEFAULT 'draft',           -- 'draft'|'queued'|'analyzing'|'generating'|'done'|'failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE property_photos (
  id              TEXT PRIMARY KEY,
  property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  photo_filename  TEXT NOT NULL REFERENCES photos(filename),
  room_type       TEXT,
  zone            TEXT,
  is_hero         BOOL NOT NULL DEFAULT FALSE,
  position        INT NOT NULL DEFAULT 0
);

CREATE TABLE batches (
  id           TEXT PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  org_id       TEXT NOT NULL REFERENCES orgs(id),
  status       TEXT NOT NULL DEFAULT 'queued',
  manifest     JSONB,                                       -- palette + furniture spec (Step 2 output)
  catalog      JSONB,                                       -- tile grid metadata per zone (Step 3 output)
  model        TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  error        TEXT
);

CREATE TABLE batch_items (
  id                TEXT PRIMARY KEY,
  batch_id          TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  property_photo_id TEXT NOT NULL REFERENCES property_photos(id),
  status            TEXT NOT NULL DEFAULT 'queued',         -- 'queued'|'generating'|'watermarking'|'done'|'failed'
  staged_url        TEXT,                                   -- final watermarked image (delivered)
  staged_raw_url    TEXT,                                   -- pre-watermark (for re-watermarking on MLS change)
  original_url      TEXT NOT NULL,                          -- AB 723 compliance pointer (immutable)
  prompt            TEXT,
  error             TEXT,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ
);

-- Compliance
CREATE TABLE disclosures (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES orgs(id),
  property_id       TEXT REFERENCES properties(id) ON DELETE SET NULL,
  batch_item_id     TEXT REFERENCES batch_items(id),
  short_code        TEXT UNIQUE NOT NULL,                   -- nanoid for /v/{code} public URL
  original_url      TEXT NOT NULL,
  staged_url        TEXT NOT NULL,
  mls               TEXT,
  watermark_config  JSONB NOT NULL,                         -- snapshot of rules at generation time
  disclosure_text   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ NULL                        -- soft-delete only; never hard-delete
);
CREATE INDEX disclosures_org ON disclosures(org_id, created_at DESC);

CREATE TABLE mls_rules (
  code                  TEXT PRIMARY KEY,                   -- 'HAR' | 'ACTRIS' | 'CA-AB723' | ...
  display_name          TEXT NOT NULL,
  jurisdiction          TEXT,
  watermark             JSONB NOT NULL,                     -- { text, position, font, sizePct, opacity }
  requires_original_url BOOL NOT NULL DEFAULT FALSE,
  disclosure_text       TEXT NOT NULL,
  version               INT NOT NULL DEFAULT 1,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed rows: HAR, ACTRIS, CRMLS, SDMLS, Bright MLS, FMLS, BeachesMLS, CA-AB723, WI-Act69

-- External API access
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,                               -- first 12 chars, queryable for lookup
  key_hash     TEXT NOT NULL,                               -- SHA-256 of full key
  last_used_at TIMESTAMPTZ,
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['batches:write'],
  revoked_at   TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX api_keys_prefix ON api_keys(key_prefix) WHERE revoked_at IS NULL;

CREATE TABLE webhook_endpoints (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  secret     TEXT NOT NULL,
  events     TEXT[] NOT NULL DEFAULT ARRAY['batch.completed'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_deliveries (
  id              TEXT PRIMARY KEY,
  endpoint_id     TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          INT,
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ
);

CREATE TABLE stripe_events_processed (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Blob storage key patterns

```
photos/{orgId}/originals/{sha256}.{ext}      ← compliance original — NEVER overwritten
photos/{orgId}/working/{filename}            ← working copy (may be downsized)
gen/{orgId}/{batchItemId}/raw.jpg            ← Gemini output before watermark
gen/{orgId}/{batchItemId}/v{n}.jpg           ← watermarked version (n increments on re-watermark)
```

---

## Application Surfaces

Three distinct UIs over one generation engine:

```
/                           Marketing + login (public)
/brief                      Disclosure Brief newsletter signup (public)
/v/[code]                   AB 723 disclosure page — original + staged (public, Edge Function)
/canvas/[id]                Existing session canvas — agent/Solo ICP (renamed from /session/[id])
/properties                 Photographer batch list — Studio ICP
/properties/[id]            Property detail + batch trigger
/admin                      Org admin (members, billing, brand settings)
/admin/compliance           Brokerage audit dashboard
/api/v1/*                   External photographer API (API-key auth)
/api/webhooks/stripe        Stripe webhook handler
/api/inngest                Inngest step function handler
```

---

## Batch Generation Architecture (Inngest)

The current synchronous `/api/generate` route cannot serve the photographer ICP. A 10-photo property batch requires 13+ Gemini calls. Vercel Pro's 300s timeout is not sufficient. Inngest step functions solve this: each step is a separate Vercel invocation (under 60s each), durable across restarts, with automatic retry.

### Pipeline

```
POST /api/v1/properties/:id/batches
  → insert batches row (status=queued)
  → inngest.send({ name: "batch/run", data: { batchId } })
  → return 202 { batchId }

Inngest: "batch/run"
  step.run("load")       → fetch property + photos, classify zones
  step.run("manifest")   → 1 Gemini text call → batches.manifest (palette + furniture spec)
  step.run("heroes")     → parallel: 1 Gemini image call per zone hero
  step.run("catalogs")   → parallel: 1 Gemini vision call per zone (tile grid extraction)
  step.run("stage/*")    → parallel: 1 image call per non-hero photo (inputs: original + hero + catalog + manifest)
  step.run("watermark/*")→ sharp pipeline: bake disclosure watermark + org logo
  step.run("disclose/*") → insert disclosures row, generate short_code, QR code
  step.run("deliver")    → enqueue webhook_deliveries, send Resend notification to photographer
  → update batches.status = 'done'
```

### Cross-room style consistency (the technical moat)

Ported from the Python CLI pipeline into Inngest steps:

1. **Manifest step:** 1 Gemini text call with all photos as input. Returns JSON with apartment-wide palette and per-zone furniture identity spec (hex colors, materials, dimensions, silhouette). Stored in `batches.manifest`.
2. **Hero step (parallel per zone):** Inputs: `[manifest JSON as text, original empty room photo]`. Output: the canonical staged hero for each zone. Stored as `batch_items.staged_raw_url` with `is_hero=true`.
3. **Catalog step (parallel per zone):** 1 Gemini vision call per hero extracts a tile grid (thumbnail of every visible furniture piece). Stored in `batches.catalog`.
4. **Stage step (parallel per non-hero photo):** Inputs: `[original empty photo, zone hero, zone catalog grid, manifest text]`. The four-input pattern locks furniture identity across camera angles.

For the canvas (Solo agent), add a `brief` node type that holds manifest text and can be connected to multiple generation nodes via the existing `ref` handle. This gives individual agents cross-room consistency without changing the canvas architecture.

---

## Compliance Architecture

### Watermarking (sharp)

```ts
async function watermark(rawBuffer: Buffer, rule: MlsRule, brand: OrgBrand): Promise<Buffer> {
  const img = sharp(rawBuffer);
  const { width } = await img.metadata();
  const fontSize = Math.round(width! * rule.watermark.sizePct);
  const svg = renderWatermarkSVG({ text: rule.watermark.text, fontSize, ... });
  return img
    .composite([
      { input: Buffer.from(svg), gravity: rule.watermark.position },
      ...(brand.logoUrl ? [{ input: await fetchLogo(brand.logoUrl), gravity: 'northwest' }] : []),
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}
```

Snapshot `watermark_config` into the `disclosures` row at generation time — rule changes never retroactively modify past disclosure records.

### Disclosure page (`/v/[code]`)

- Server component, deployed as Vercel Edge Function (geographically distributed, read-heavy)
- Shows: original photo, staged photo side-by-side with swipe comparison (use `react-compare-slider`)
- Shows: disclosure text, MLS rule applied, date generated, org name
- `/v/{code}/manifest.json` for machine readers
- QR code pointing to this URL is generated with `qrcode` npm package at disclosure creation time

### E&O audit export

`GET /api/orgs/{id}/disclosures/export?from=&to=&format=pdf|csv`

PDF generated server-side with `@react-pdf/renderer` — includes original/staged thumbnails, disclosure text, MLS rule version snapshot, and a hash of all records (tamper-evidence). CSV for bulk import into compliance management systems.

### MLS rules as data

`mls_rules` table, seeded at migration time. Rules can be updated by Vercel cron without a code deploy:

```json
{
  "code": "HAR",
  "watermark": {
    "text": "Image does not represent actual property as is",
    "position": "south",
    "sizePct": 0.025,
    "opacity": 0.85
  },
  "requires_original_url": false,
  "disclosure_text": "Virtually staged for illustrative purposes only."
}
```

---

## Billing (Stripe)

### Products

| Product | Monthly Price | Annual Price | Notes |
|---|---|---|---|
| Solo | $39/mo | $374/yr | 25 images/mo included |
| Studio | $149/mo | $1,430/yr | 500 images/mo, overage at $1.50/image |
| Brokerage | $399/mo | $3,830/yr | 5 seats, $39/seat overage |

### Implementation

- `stripe-node` + `/api/webhooks/stripe` handler with signature verification
- Stripe Customer Portal for self-serve upgrade/downgrade/cancel
- Seat quantity on Brokerage = `quantity` on Stripe subscription
- Overage billing: count `usage_events` per period in DB; end-of-period Vercel Cron creates one-time `invoice_item` for `(used - included) * 150` cents

### Webhooks to handle

```
checkout.session.completed        → upsert billing_subscriptions, set tier
customer.subscription.updated     → sync tier, seats, status
customer.subscription.deleted     → downgrade to solo / status=canceled
invoice.payment_failed            → notify org admin, status=past_due
```

Always write `stripe_events_processed` before processing — idempotent.

---

## External API (v1)

### Auth

API key format: `isk_live_{32 random chars}`. Stored SHA-256 hashed (no PBKDF2 — keys are high-entropy). Lookup by `key_prefix` (first 12 chars), then constant-time full hash compare.

### Rate limiting

`@upstash/ratelimit` with Upstash Redis (Vercel Marketplace integration). Sliding window per API key: Studio = 60 req/min, Brokerage = 240 req/min.

### Key endpoints

```
POST   /api/v1/properties                          create property
POST   /api/v1/properties/:id/photos               upload photo (returns signed blob URL)
POST   /api/v1/properties/:id/batches              kick off batch → 202 with batchId
GET    /api/v1/batches/:id                         status + item list
GET    /api/v1/batches/:id/items/:itemId           individual item with staged + disclosure URLs
POST   /api/v1/webhooks                            register delivery endpoint
DELETE /api/v1/webhooks/:id
GET    /api/v1/keys                                list org's API keys
POST   /api/v1/keys                                create API key
DELETE /api/v1/keys/:id                            revoke
```

Photo uploads go directly to Vercel Blob via `handleUpload` signed token — not proxied through the serverless function.

### Webhook delivery

HMAC-SHA256 signed (`X-Signature-256` header). Exponential backoff: 1m → 5m → 30m → 2h → 12h → 24h. Delivered via Inngest step function on the batch-complete event.

### OpenAPI

Zod schemas on all routes → auto-generate OpenAPI spec with `zod-openapi`.

---

## Multi-tenancy (Orgs + Sub-accounts)

**Auth:** Migrate to Clerk v6. Clerk Organizations maps 1:1 to `orgs`. Replaces `session_invites` table + `next-auth` invite flow. Adds email/password auth without building it.

**Sub-accounts:** Photographer creates child orgs for each agent client (`parent_org_id`). Photographer admin can read/write all child orgs. Agent client has a `member` role in their child org. Photos and properties belong to the child org; photographer's dashboard shows them aggregated.

**`resolveOrgAccess(orgId, userId)`** — extends current `resolveAccess` pattern:
- If user is `org_members.role = owner/admin` of the org → full access
- If user is `org_members.role = admin` of the parent org → full access to all child orgs
- If user is `org_members.role = member` → read/write own resources only

**White-label:** `org.brand` JSON holds `{ logoUrl, primaryColor, watermarkText }`. Applied at watermark time in Inngest step. No custom domains in v1 — path-based (`/s/{photographer-slug}/...`) styled with org brand.

---

## Newsletter (Loops.so)

**"The Disclosure Brief"** — weekly newsletter on AI disclosure law for real estate. Marketing engine and distribution channel.

- Loops.so handles list management, lifecycle automation, and weekly sends
- Resend handles transactional emails (batch complete, disclosure link delivery, trial expiry)
- Email capture: `/brief` route, public, `POST /api/brief/subscribe` → Loops API
- Lifecycle sequences in Loops: trial → activation → at-risk → churn save

---

## Route Map (after refactor)

```
/                              → Marketing + login (public)
/brief                         → Newsletter signup (public)
/v/[code]                      → Disclosure page (public, Edge)
/canvas/[id]                   → Session canvas (Solo ICP) — renamed from /session/[id]
/properties                    → Photographer property list
/properties/[id]               → Property detail, photo upload, batch trigger, item statuses
/admin                         → Org admin: members, billing, brand
/admin/compliance              → Brokerage: disclosure audit, export
/api/canvas                    → Existing canvas save/load (no change)
/api/generate                  → Existing single-node generation (no change for Solo)
/api/sessions/*                → Existing session management (no change)
/api/photos/*                  → Existing photo management (no change)
/api/batches/*                 → New: batch status for UI polling
/api/v1/*                      → External API (API-key auth)
/api/webhooks/stripe           → Stripe webhook handler
/api/inngest                   → Inngest step function handler
/api/brief/subscribe           → Newsletter signup handler
/api/orgs/[id]/disclosures     → Compliance export
```

Existing `/session/[id]` URLs → 301 redirect to `/canvas/[id]`.

---

## Development Cycle

### Phase 0 — Foundations (1–2 weeks, no new user-facing features)
*Goal: eliminate tech debt that would block everything else.*

1. **Adopt drizzle-orm + drizzle-kit.** Replace the inline `migrate()` / hand-written SQL. Add a `db:migrate` step to the Vercel build. Versioned, safe migrations from here forward.
2. **Add Zod to all existing API routes.** Input validation on every route handler. Foundation for OpenAPI generation later.
3. **Add Sentry + Vercel OpenTelemetry.** Vercel Marketplace integration. Required before batch jobs — you need traces to debug multi-step failures.
4. **Add `orgs` and `org_members` tables.** Backfill: one `type='solo'` org per existing user; set `org_id` on their sessions and photos. No UX changes yet.

### Phase 1 — Solo paid tier + first revenue (2 weeks)
*Goal: charge money. Validates the payment pipeline before anything else.*

5. **Stripe integration.** Products, prices, Customer Portal, webhook handler, `billing_subscriptions` table. Clerk integration for auth.
6. **Usage tracking.** Write `usage_events` from `/api/generate`. Add free quota (25 gen/mo for Solo).
7. **Paywall.** Canvas shows upgrade prompt after quota is hit. Free trial: 7 days / 3 generations — whichever comes first.
8. **Ship $39/mo Solo tier.**

Milestone: first paying customer. Validates Stripe wiring and conversion funnel before investing in photographer features.

### Phase 2 — Studio batch core (3–4 weeks)
*Goal: give photographers the batch-by-property workflow. This is the wedge.*

9. **Inngest integration.** `/api/inngest` handler, basic "batch/run" function.
10. **Property tables.** `properties`, `property_photos`, `batches`, `batch_items`.
11. **Properties UI.** `/properties` list + `/properties/[id]` detail with photo upload grid, style brief form, batch trigger button, and real-time item status grid (polling `GET /api/batches/:id`).
12. **Port the consistency pipeline.** Manifest → hero → catalog → rest, each as Inngest steps. Multi-image Gemini inputs per the Python CLI approach.
13. **Ship Studio tier ($149/mo).** Without API, without sub-accounts, without compliance polish. The batch workflow alone justifies the price.

Milestone: first Studio paying photographer. Validates that batch workflow is the pain and that $149 is the right price.

### Phase 3 — Compliance + white-label (3 weeks)
*Goal: own the compliance narrative before incumbents catch up.*

14. **`disclosures` and `mls_rules` tables.** Seed `mls_rules` with HAR, ACTRIS, CRMLS, SDMLS, Bright MLS, FMLS, BeachesMLS, CA-AB723, WI-Act69.
15. **Watermarking step in Inngest.** Sharp-based, per-MLS rule, per-org brand.
16. **`/v/[code]` public disclosure page.** Edge function, before/after swipe, QR code generation.
17. **Org branding.** Logo upload, watermark text, brand colors in `/admin`.
18. **Ship compliance as included in Studio.** This is the moat against Aryeo/VSAI.

Milestone: first photographer using compliance features. Validates the AB 723 angle and enables the brokerage pitch.

### Phase 4 — Sub-accounts + external API (3 weeks)
*Goal: unlock the B2B2C play — photographers reselling to agents as a managed service.*

19. **Sub-account / parent org semantics.** Photographer creates "client workspaces." `resolveOrgAccess` parent-child logic.
20. **`api_keys` table + Bearer auth middleware.** API key create/revoke UI in `/admin`.
21. **`webhook_endpoints` + delivery Inngest function.** HMAC-signed delivery to photographer's endpoint.
22. **`/api/v1/*` routes.** Properties, photos (signed upload), batches, webhook management. Zod-derived OpenAPI spec.
23. **Rate limiting.** Upstash Redis + `@upstash/ratelimit`.
24. **Ship the photographer integration story.** Publish API docs. Lightroom plugin spec sheet.

Milestone: first photographer submitting a batch via API (not the UI). Proves the integration channel is viable.

### Phase 5 — Brokerage tier (3–4 weeks)
*Goal: highest ARPU tier. Single-decider sales. Very low churn.*

25. **Seat-based Stripe pricing.** Brokerage product with per-seat quantity.
26. **Compliance audit dashboard** (`/admin/compliance`). Filterable by agent, date, MLS board. Shows original/staged pairs and disclosure status.
27. **E&O audit export** (`@react-pdf/renderer`). PDF with thumbnails, disclosure text, rule snapshot, and record hash.
28. **Per-MLS watermark configuration UI.** Brokerage admin selects their MLS board(s); watermark rules auto-apply to all agents in the org.
29. **Ship Brokerage tier ($399/mo).**

Milestone: first brokerage customer. Validates the compliance officer / broker-owner sales motion.

### Phase 6 — Distribution (ongoing, parallel to Phase 5)

30. **"The Disclosure Brief" newsletter.** Loops.so integration, `/brief` page, weekly cadence. Content: state-by-state compliance tracker, MLS rule updates, AI staging news.
31. **PFRE vendor listing.** Sponsored post timed to Phase 3 shipping (the compliance story is what makes it newsworthy).
32. **Spiro partnership outreach.** White-label/revenue-share pitch. Low probability, asymmetric upside. One email by end of Phase 3.
33. **Cole Connor guest post.** Timed to batch workflow shipping (Phase 2). The B2B2C margin math + Aryeo-independence angle.

---

## Key Library Decisions (consolidated)

| Need | Library | Rationale |
|---|---|---|
| Migrations + typed DB | drizzle-orm + drizzle-kit | Neon-native; typed; replaces unsafe hand SQL |
| Async batch jobs | Inngest | Step durability; survives Vercel timeouts; fits the pipeline DAG |
| Auth + orgs | Clerk v6 | Org management, invites, and email/pw auth for free |
| Billing | stripe-node + Customer Portal | No SaaS billing platform needed at this scale |
| Rate limiting | @upstash/ratelimit | Vercel Marketplace; zero infra |
| Input validation | Zod | Foundation for OpenAPI generation |
| PDF export | @react-pdf/renderer | React components → compliance-grade PDFs |
| Watermarking | sharp (already in stack) | No new dependency |
| QR codes | qrcode | Tiny, server-side, no canvas |
| Newsletter + lifecycle | Loops.so | One vendor; SaaS-native lifecycle automation |
| Transactional email | Resend | Best DX; Vercel-native |
| Observability | Sentry + Vercel OTel | Required before batch jobs for debugging |
| Disclosure swipe UI | react-compare-slider | Before/after swipe on `/v/[code]` |
| OpenAPI spec | zod-openapi | Auto-generate from Zod schemas; no manual YAML |

---

## Risks and Mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| Zillow opens VSAI to non-Aryeo photographers at $0–19/mo | Medium (18 months) | Own the batch workflow + compliance features Zillow structurally can't ship without breaking Aryeo's agent-facing model |
| Gemini API price increase 3–5x | Low-medium | Track cost per generation in `usage_events`; overage pricing absorbs modest increases |
| Styldod extends CRMLS integration to generate-time structural checks | Medium (12 months) | Cross-room consistency is the harder moat; ship Phase 2 before they catch up |
| AB 723 legal challenge or stay | Low | Compliance remains a brand/trust signal even if the law is stayed; the disclosure workflow is still best practice |
| Spiro or HDPhotoHub bolts on native staging | Low-medium | API-first design (Phase 4) means the product can become their staging backend rather than compete with them |
| Drizzle migration race on Neon cold starts | Certain if not addressed | Move to build-time migrations in Phase 0 before any concurrent production traffic |
| Vercel Blob total cost at scale | Low near-term | ~$0.15/GB/mo; 10K generations = 30GB = $4.50/mo; revisit at 1TB |

---

## Out of Scope (for now)

- Mobile app
- Custom subdomains / white-label domains (Phase 6+)
- Mask / inpainting precision (not needed — Gemini handles placement)
- Commercial real estate / office spaces
- Video / virtual tours
- 360° photo staging
- Self-hosted / on-premise deployment
- Furniture removal from occupied rooms
- Direct MLS submission API
- iOS/Android Lightroom plugin (spec only in Phase 4; build is third-party or community)

---

## Success Metrics

| Metric | Phase 1 Target | Phase 3 Target | Phase 5 Target |
|---|---|---|---|
| MRR | $500 (10 Solo) | $3,000 (15 Studio) | $10,000 (Studio + Brokerage mix) |
| Paying customers | 10 | 25 | 40 |
| Blended ARPU | $50 | $120 | $250 |
| Studio logo churn | — | <5%/mo | <3%/mo |
| Agent sub-accounts per Studio | — | >3 within 60 days | >8 |
| Annual prepay rate | 20% | 40% | 50% |
| Batch completion rate (no error) | — | >95% | >98% |
| Disclosure features used (% of batches) | — | 80% | 95% |
