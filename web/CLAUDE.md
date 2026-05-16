@AGENTS.md

---

# Web App — Architecture Reference

## Tech Stack

| Layer | Library | Notes |
|---|---|---|
| Framework | Next.js 16.2.6 | App Router |
| React | 19.2.4 | |
| Canvas | @xyflow/react ^12 | Solo ICP surface only |
| Auth | next-auth v4 (Google OAuth) | |
| Database | @neondatabase/serverless ^1 | `sql` tag; Drizzle ORM for new tables |
| ORM | drizzle-orm + drizzle-kit | Typed queries on new schema; legacy tables use raw `sql` |
| AI | @google/genai v2 | Gemini image generation |
| Async jobs | inngest | Step-function batch pipeline; webhook delivery |
| Storage | @vercel/blob ^1 | Photos + generation outputs |
| Styles | Tailwind CSS v4 + shadcn | Earth-tone palette |
| Image processing | sharp | Watermarking + resize |
| Billing | stripe-node | Customer Portal; lazy singleton via `getStripe()` |
| Rate limiting | @upstash/ratelimit + @upstash/redis | API key rate limiting; lazy init |
| Input validation | zod | All API routes |
| Transactional email | resend | Welcome emails, from `brief@altitudedp.com` |
| Newsletter | loops | Loops.so lifecycle automation; gracefully no-ops if key missing |
| PDF export | @react-pdf/renderer | E&O compliance audit PDFs |
| QR codes | qrcode | Server-side, tiny |
| Observability | @sentry/nextjs | Client + server + edge configs |
| Disclosure UI | react-compare-slider | Before/after swipe on `/v/[code]` |
| API docs | @asteasolutions/zod-to-openapi + @scalar/nextjs-api-reference | Auto-generated OpenAPI spec + Scalar UI |

## Environment Variables

**Do not hand-edit `.env.local`.** Pull from Vercel:

```bash
vercel link --project interior-staging-image-generation --scope nmyingers-projects
vercel env pull .env.local --yes
```

All variables provisioned on Vercel (Production + Preview + Development):

```
# Core
DATABASE_URL=              # Neon connection string
GEMINI_API_KEY=            # Google AI Studio key
GOOGLE_CLIENT_ID=          # Google OAuth
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=              # e.g. http://localhost:3000
BLOB_READ_WRITE_TOKEN=     # Vercel Blob store

# Stripe (live)
STRIPE_SECRET_KEY=         # sk_live_... — lazy init via getStripe()
STRIPE_WEBHOOK_SECRET=     # whsec_... — webhook endpoint signing secret
STRIPE_PRICE_SOLO_MONTHLY=         # price_1TX9mN...
STRIPE_PRICE_SOLO_ANNUAL=          # price_1TX9mN...
STRIPE_PRICE_STUDIO_MONTHLY=       # price_1TX9mN...
STRIPE_PRICE_STUDIO_ANNUAL=        # price_1TX9mO...
STRIPE_PRICE_BROKERAGE_MONTHLY=    # price_1TX9mO...
STRIPE_PRICE_BROKERAGE_ANNUAL=     # price_1TX9mO...

# Inngest
INNGEST_EVENT_KEY=         # send events to Inngest
INNGEST_SIGNING_KEY=       # verify Inngest → app requests

# Upstash Redis (rate limiting)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Email / Newsletter
RESEND_API_KEY=            # send-only restricted key
RESEND_FROM_DOMAIN=        # altitudedp.com (domain verified in Resend)
LOOPS_API_KEY=             # Loops.so lifecycle — optional, gracefully skipped if absent

# Observability
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=         # build-only: source map upload
```

## Database Schema

### Legacy tables (`lib/db.ts` — auto-migrated via `migrate()`)

```
users               id (Google sub), email, name, image, default_org_id
photos              filename (PK), user_id, org_id, sha256, mime_type,
                    image_url (blob), image_b64 (fallback), original_url
sessions            id, owner_user_id → users, name, org_id,
                    link_access ('private'|'view'|'edit'), share_password_hash
canvas_nodes        id, session_id, type, x, y, data (JSONB)
canvas_edges        id, session_id, source, source_handle, target, target_handle
generation_history  id, node_id, session_id, output_url, output_b64, created_at
session_invites     id, session_id, email, role ('viewer'|'editor'), created_at
```

### New tables (`lib/schema.ts` — Drizzle; migration: `drizzle/migrations/0001_new_tables.sql`)

```
orgs                id, type ('solo'|'studio'|'brokerage'), name, slug (UNIQUE),
                    parent_org_id → orgs (sub-accounts), brand JSONB, settings JSONB
org_members         id, org_id, user_id, role ('owner'|'admin'|'member'), status
billing_subscriptions  org_id (UNIQUE), stripe_customer_id, stripe_subscription_id,
                       tier, status, seats_purchased, current_period_start/end
usage_events        id (BIGSERIAL), org_id, user_id, kind, model, cost_cents,
                    billing_period_start, ref_id, created_at
properties          id, org_id, client_org_id, name, address, mls, style_brief JSONB,
                    status ('draft'|'queued'|'analyzing'|'generating'|'done'|'failed')
property_photos     id, property_id, photo_filename, zone, is_hero, position, room_id → property_rooms
property_rooms      id, property_id, name, prompt, position, created_at
                    — migration: drizzle/migrations/0002_property_rooms.sql
batches             id, property_id, org_id, status, manifest JSONB, catalog JSONB
batch_items         id, batch_id, property_photo_id, status, staged_url, staged_raw_url,
                    original_url, error
disclosures         id, org_id, short_code (UNIQUE, nanoid 7), property_id,
                    original_url, staged_url, mls, disclosure_text, watermark_config JSONB,
                    created_at, revoked_at
mls_rules           code (PK), watermark JSONB, requires_original_url, disclosure_text
                    — seeded with 9 boards: HAR, ACTRIS, CA-AB723, WI-Act69, CRMLS,
                      SDMLS, Bright, FMLS, BeachesMLS
api_keys            id, org_id, name, key_prefix (indexed), key_hash (SHA-256),
                    created_at, revoked_at, last_used_at
webhook_endpoints   id, org_id, url, events JSONB, secret, created_at
webhook_deliveries  id, endpoint_id, event_type, payload JSONB, status,
                    response_status, delivered_at
stripe_events_processed  stripe_event_id (PK) — idempotency for webhook handler
```

**Sub-accounts:** `orgs.parent_org_id` self-references `orgs`. A Studio photographer creates child orgs for each agent client. `lib/orgs.ts` provides `getUserOrg`, `createSubAccount`, `listSubAccounts`.

**Org settings JSONB shape:** `{ activeMls: string[], defaultModel?: string, defaultMls?: string, pending_client_email?: string }`

## API Routes

### Canvas / Sessions (existing)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/sessions` | GET, POST | session | List / create sessions |
| `/api/sessions/[id]` | PATCH, DELETE | session | Rename / delete |
| `/api/sessions/[id]/share` | GET, PATCH | owner | Link access + password |
| `/api/sessions/[id]/invites` | POST, DELETE | owner | Manage email invites |
| `/api/sessions/[id]/verify-password` | POST | none | Verify share password |
| `/api/canvas` | GET, POST | resolveAccess | Load / save canvas state |
| `/api/generate` | POST | session + write | Gemini generation; 402 when quota exceeded |
| `/api/photos` | GET, POST | session | List / upload photos |
| `/api/photos/[filename]` | GET | session | Serve resized photo |
| `/api/history/[nodeId]` | GET | resolveAccess | Generation history |
| `/api/history/[nodeId]/restore` | POST | session + write | Restore history entry |

### Properties + Batches

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/properties` | GET, POST | session | List / create properties |
| `/api/properties/[id]` | GET, PATCH, DELETE | session | Property CRUD; GET returns `{ ...property, photos, rooms, latest_batch }` |
| `/api/properties/[id]/rooms` | GET, POST | session | List / create rooms for a property |
| `/api/properties/[id]/rooms/[roomId]` | PATCH, DELETE | session | Update room name/prompt/position; delete room (photos lose room_id) |
| `/api/properties/[id]/photos` | POST, PATCH, DELETE | session | Link photo (POST); move room or bulk-reorder positions (PATCH); remove (DELETE) |
| `/api/properties/[id]/batches` | GET, POST | session | List / create batches; POST accepts optional `roomId` to stage one room; fires Inngest |
| `/api/batches/[id]` | GET | session | Poll batch status + per-item URLs and statuses |

### Billing

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/billing/checkout` | POST | session | Create Stripe Checkout session |
| `/api/billing/portal` | POST | session | Open Stripe Customer Portal |
| `/api/webhooks/stripe` | POST | Stripe sig | Handle subscription lifecycle events |

### Inngest

| Route | Methods | Purpose |
|---|---|---|
| `/api/inngest` | GET, POST, PUT | Inngest serve handler — registers `batchRunFunction` + `webhookDeliveryFunction` |

### Admin

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/admin/team` | POST | session | Create sub-account (child org) |
| `/api/admin/settings` | GET, PATCH | session | Org settings + MLS rules |
| `/api/admin/disclosures/[id]/revoke` | POST | session | Revoke a disclosure (set revoked_at) |
| `/api/admin/compliance/export` | GET | session | Stream E&O PDF (`?period=90` or `?period=all`) |

### External API v1 (Bearer token auth)

All `/api/v1/*` routes require `Authorization: Bearer isk_live_...` header. Rate limited via Upstash (60 req/min sliding window per key).

| Route | Methods | Purpose |
|---|---|---|
| `/api/v1/keys` | GET, POST | List / create API keys (session auth, not Bearer) |
| `/api/v1/keys/[id]` | DELETE | Revoke API key |
| `/api/v1/properties` | GET, POST | List / create properties |
| `/api/v1/properties/[id]` | GET, PATCH | Get / update property |
| `/api/v1/properties/[id]/photos` | POST | Upload photo (body: `{ filename, content_type, b64 }`) |
| `/api/v1/properties/[id]/batches` | GET, POST | List / create batches |
| `/api/v1/webhooks` | GET, POST | List / register webhook endpoints |
| `/api/v1/webhooks/[id]` | DELETE | Remove webhook endpoint |
| `/api/v1/openapi.json` | GET | Static OpenAPI 3.0 spec |

### Public

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/brief/subscribe` | POST | none | Newsletter subscribe (Resend welcome + Loops.so contact) |
| `/v/[code]` | GET | none | AB 723 public disclosure page (Edge runtime) |
| `/docs` | GET | none | Scalar interactive API reference |

## Pages

| Page | Type | Purpose |
|---|---|---|
| `/` | server | LoginGate — redirects to `/session` list if authed |
| `/session/[id]` | server | Canvas editor |
| `/properties` | server | Property list with status badges |
| `/properties/new` | static | Create property form |
| `/properties/[id]` | client | Property detail: rooms-first layout — each room is a `RoomCard` with its own upload zone, prompt, and Stage button; photos are sortable within a room and draggable between rooms via `@dnd-kit`; headless `BatchPoller` drives per-photo loading states inline |
| `/admin` | server | Admin nav dashboard (7 cards) |
| `/admin/billing` | server | Plan status, usage bar, upgrade/manage buttons |
| `/admin/compliance` | server + client | Disclosure audit table with filters, revocation, CSV export |
| `/admin/api-keys` | client | Create/list/revoke API keys; one-time raw key reveal |
| `/admin/team` | server | Team members + client workspace grid |
| `/admin/team/new` | client | Create client workspace form |
| `/admin/team/[id]` | server | Client workspace detail |
| `/admin/settings` | client | MLS board selector; watermark rules |
| `/brief` | client | Newsletter landing page |
| `/v/[code]` | Edge | Public AB 723 disclosure (before/after slider) |
| `/docs` | route handler | Scalar API reference |

## Key Libraries — Usage Patterns

### API Key Auth (`lib/api-auth.ts`)
```ts
// Key format: isk_live_{nanoid(32)}
// Stored: SHA-256 hash. Lookup by key_prefix (first 12 chars), then timingSafeEqual compare.
import { withApiAuth } from '@/lib/api-auth';
export async function GET(req) {
  return withApiAuth(req, async (orgId, keyId) => { ... });
}
```

### Billing (`lib/billing.ts`)
```ts
import { canGenerate, recordGeneration } from '@/lib/billing';
const { allowed, reason, tier } = await canGenerate(userId);
if (!allowed) return NextResponse.json({ error: 'quota_exceeded', reason }, { status: 402 });
await recordGeneration({ userId, orgId, nodeId, model, costCents });
```

### Stripe singleton (`lib/stripe.ts`)
```ts
import { getStripe } from '@/lib/stripe'; // lazy — safe to import at module level
const session = await getStripe().checkout.sessions.create({ ... });
```

### Inngest batch pipeline (`lib/jobs/batch-run.ts`)
Four steps: `load` → `manifest` → `hero-{zone}` (parallel per zone) → `stage-{photoId}` (parallel per photo). Fires `batch/completed` or `batch/failed` on terminal state, which triggers `webhookDeliveryFunction`.

### Disclosure creation (`lib/disclosures.ts`)
```ts
import { createDisclosure, getDisclosureUrl } from '@/lib/disclosures';
const { short_code } = await createDisclosure({ orgId, originalUrl, stagedUrl, mls, propertyId });
const publicUrl = getDisclosureUrl(short_code); // https://app/v/{code}
```

### Watermarking (`lib/watermark.ts`)
```ts
import { applyWatermark } from '@/lib/watermark';
const watermarked = await applyWatermark(imageBuffer, { text: 'Virtually Staged', gravity: 'SouthEast' });
```

### PDF export (`lib/pdf/eo-report.tsx`)
```ts
import { renderToBuffer } from '@react-pdf/renderer';
import { EoReport } from '@/lib/pdf/eo-report';
const pdf = await renderToBuffer(<EoReport orgName={...} disclosures={rows} ... />);
```

### Loops.so (`lib/loops.ts`)
```ts
import { subscribeToNewsletter } from '@/lib/loops';
await subscribeToNewsletter({ email, firstName, source: 'brief-page' });
// No-ops silently if LOOPS_API_KEY is not set
```

### Org helpers (`lib/orgs.ts`)
```ts
import { getUserOrg, createSubAccount, listSubAccounts } from '@/lib/orgs';
const org = await getUserOrg(userId);
const { org: child } = await createSubAccount({ parentOrgId: org.id, name, clientEmail });
```

## Billing Architecture

**Tiers:** Solo ($39/mo, 25 gen), Studio ($149/mo, 500 gen + overage), Brokerage ($399/mo, 5 seats).

**Free tier:** 3 generations — checked by `canGenerate()` before every Gemini call.

**Quota enforcement:** `POST /api/generate` returns HTTP 402 `{ error: "quota_exceeded" }` when limit reached. Client should surface an upgrade prompt.

**Stripe webhook flow:** `checkout.session.completed` → create/link org → upsert `billing_subscriptions`. `customer.subscription.updated/deleted` → update status. `invoice.payment_failed` → mark `past_due`. All events use `stripe_events_processed` for idempotency.

**Stripe products (live):** Created in Altitude Development Partners LLC account. Coupon `FOUNDINGSTUDIO` = 33% off forever, max 25 redemptions.

## Inngest Functions

| Function ID | Trigger | Purpose |
|---|---|---|
| `batch-run` | `batch/run` event | 4-step staging pipeline |
| `webhook-delivery` | `batch/completed`, `batch/failed` | HMAC-signed delivery to photographer endpoints |

**Webhook delivery signing:**
```
x-staging-signature: sha256=<hex>
```
HMAC-SHA256 of `JSON.stringify(payload)` using the endpoint's stored secret.

## Compliance Architecture

**AB 723 (California, Jan 2026):** Every virtually staged image must include a disclosure watermark AND a permanent public URL to the original unaltered photo.

**Flow:** `applyWatermark()` → upload staged image to blob → `createDisclosure()` → short URL `/v/{code}` → public page with before/after slider.

**E&O PDF:** `GET /api/admin/compliance/export?period=90` streams a PDF with thumbnails, disclosure text, MLS rule snapshot, and SHA-256 record hash per disclosure. Used for insurance documentation.

**MLS rules:** Seeded in `mls_rules` table. Brokerage selects active boards in `/admin/settings`; stored in `orgs.settings.activeMls`. Rules auto-apply to all watermarks for that org.

## Canvas Architecture (`components/canvas/`)

```
StageCanvas.tsx         Root — owns nodes/edges state, save, undo
SourceNode.tsx          Photo node (type: "photo")
GenerationNode.tsx      Generation node (type: "generation")
DeletableEdge.tsx       Edge with delete hover affordance
MenuBar.tsx             Bottom-center toolbar
NodeInspectorPanel.tsx  Right-side panel — prompt, model picker, history, download
SessionContext.ts       { sessionId: string; readOnly: boolean }
```

### Node Handles
- **SourceNode:** `photo` right handle (stone-400)
- **GenerationNode:** `base` left top (stone-400, required), `ref` left bottom (acacia-400, optional), `output` right (sage-500)

## Properties Components (`components/properties/`)

| Component | Purpose |
|---|---|
| `StatusBadge.tsx` | 6-state badge: draft/queued/analyzing/generating/done/failed |
| `RoomCard.tsx` | Self-contained room card — file upload zone, prompt textarea, Stage button, sortable photo rows (Unfurnished/Furnished columns). Exports `PropertyPhoto` and `PropertyRoom` types used by the page. Uses `@dnd-kit/sortable` (`useSortable` + `SortableContext`) for within-room reordering and `useDroppable` for cross-room drops. |
| `BatchProgress.tsx` | Exports `BatchPoller` (headless, renders null) — polls `GET /api/batches/[id]` every 3s and fires `onUpdate(items)` / `onComplete(items)` callbacks. Also exports the visual `BatchProgress` component (progress bar + per-item list) used in other contexts. |

## Access Control

### Session access (`lib/access.ts`)
`resolveAccess(sessionId, uid, email)` → `{ role, canWrite, canRead, needsPassword }`

Resolution order: owner → email invite → link_access (view/edit) → none.

Password system: PBKDF2-SHA256, 210k iterations. Cookie: `spw-{sessionId}`, 7-day TTL.

### API key auth (`lib/api-auth.ts`)
Key format: `isk_live_{nanoid(32)}`. Stored as SHA-256 hash. Lookup: `key_prefix` index + `timingSafeEqual`. Updates `last_used_at` fire-and-forget. Rate limit: 60 req/min sliding window (Upstash).

## AI Models (`lib/models.ts`)

| ID | Label | Notes |
|---|---|---|
| `gemini-3.1-flash-image-preview` | Gemini 3.1 Flash | Default |
| `gemini-3-pro-image-preview` | Gemini 3 Pro | Studio quality |
| `gemini-2.5-flash-image` | Gemini 2.5 Flash | Stable |

Generation: `responseModalities: ["IMAGE"]`, 1 auto-retry on empty candidates.

## Image Storage (`lib/storage.ts`)

Blob key conventions:
- `photos/{userId}/{filename}` — user uploads
- `gen/{nodeId}/{timestamp}.jpg` — canvas generation outputs
- `photos/{orgId}/originals/{sha256}.{ext}` — compliance original copies
- `gen/{orgId}/{batchItemId}/raw.jpg` — batch pipeline outputs

Falls back to base64-in-DB when `BLOB_READ_WRITE_TOKEN` is not set.

## Image Serving

**Never use raw Vercel Blob URLs in `<img>` tags.** Blob URLs are full-resolution and uncompressed — they will always be slow. Two proxy routes handle all images:

### `/api/photos/[filename]?w=<width>` — user-uploaded photos
Routes through the `photos` table (keyed by filename). Fetches from Blob, resizes with Sharp, returns JPEG at 85% quality with `Cache-Control: public, max-age=31536000, immutable`. Use when you have a `photo_filename` / `photos.filename` value.

### `/api/blob-proxy?url=<encoded>&w=<width>` — AI-generated outputs
Use for `staged_url`, `output_url`, `outputUrl` — anything written by the Gemini pipeline that isn't in the `photos` table. Validates the URL is a Vercel Blob hostname (SSRF guard), then same Sharp + cache behavior. Pass `data:` and `blob:` URLs through unchanged (they're already local).

**Why not `next/image`?** Photos are auth-gated — both proxy routes call `getServerSession` before serving. `next/image` serves through `/_next/image` which doesn't carry the user's session cookie and cannot enforce access control. The Sharp proxy pattern is correct here.

**Width conventions:**

| Context | Proxy | `?w=` |
|---|---|---|
| Property list thumbnails | `/api/photos/` | `?w=200` |
| Canvas list thumbnails | `/api/photos/` | `?w=200` |
| Batch progress thumbnails | `/api/photos/` (original) or `/api/blob-proxy` (staged) | `?w=120` |
| Property detail / drag overlay | `/api/photos/` | `?w=300` (canvas), `?w=600` (room card) |
| Inspector panel photo preview | `/api/photos/` via `largerUrl()` | `?w=600` |
| Inspector panel gen output | `/api/blob-proxy` via `displayProxySrc()` | `?w=800` |
| Generation node preview | `/api/blob-proxy` | `?w=600` |
| Room card staged result | `/api/blob-proxy` | `?w=600` |
| No `?w=` param on photos route | — | Pass-through redirect to raw Blob (full-res) |

**`data:` and `blob:` URLs** (base64 legacy payloads, upload previews) are never proxied — they're already in memory.

**Known limitation:** `Cache-Control: immutable` is set, but filenames are user-supplied (not content-addressed). A re-uploaded file with the same name will be stale in browser cache until the year-long TTL expires.

## CSS Tokens

`--radius-node: 10px` in `:root` — change once to update all nodes.

Custom palette (`@theme` in `globals.css`): `sage-*`, `acacia-*`, `clay-*`, `moss-500`. Tailwind `stone-*` is the neutral. **Never use violet/purple/indigo/blue.**

## Dev Commands

```bash
cd web
npm run dev        # development server
npm run build      # production build
npm run lint       # eslint
npm run db:migrate # run drizzle migrations
npm run db:studio  # open Drizzle Studio
```

**First-time local setup:**
```bash
cd web
vercel link --project interior-staging-image-generation --scope nmyingers-projects
vercel env pull .env.local --yes
npm run dev
```
