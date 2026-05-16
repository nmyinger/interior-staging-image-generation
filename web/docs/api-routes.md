# API Routes

All routes live under `web/app/api/`. Every route calls `getServerSession(authOptions)` first and returns 401 before touching the DB. External v1 routes use `withApiAuth()` instead.

## Canvas / Sessions

| Route | Methods | Purpose |
|---|---|---|
| `/api/sessions` | GET, POST | List sessions (filterable by `?property_id=`); create session |
| `/api/sessions/[id]` | PATCH, DELETE | Rename / delete |
| `/api/sessions/[id]/share` | GET, PATCH | Link access level + share password |
| `/api/sessions/[id]/invites` | POST, DELETE | Email invites (viewer/editor) |
| `/api/sessions/[id]/verify-password` | POST | Verify share password (no auth required) |
| `/api/canvas` | GET, POST | Load / save full canvas state (nodes + edges) |
| `/api/generate` | POST | Gemini image generation; returns 402 `{ error: "quota_exceeded" }` when limit hit |
| `/api/photos` | GET, POST | List photos for user; upload a photo (blob or base64) |
| `/api/photos/[filename]` | GET | Sharp proxy — resizes + caches; accepts `?w=N` |
| `/api/blob-proxy` | GET | Sharp proxy for AI outputs; accepts `?url=<encoded>&w=N`; SSRF-guarded to Blob hostnames |
| `/api/history/[nodeId]` | GET | Generation history for a canvas node |
| `/api/history/[nodeId]/restore` | POST | Restore a history entry to a node |

## Properties + Rooms + Batches

| Route | Methods | Purpose |
|---|---|---|
| `/api/properties` | GET, POST | List / create properties |
| `/api/properties/[id]` | GET, PATCH, DELETE | Property CRUD; GET returns `{ ...property, photos, rooms, latest_batch }` |
| `/api/properties/[id]/rooms` | GET, POST | List / create rooms; POST auto-assigns next position |
| `/api/properties/[id]/rooms/[roomId]` | PATCH, DELETE | Update room name/prompt/position; DELETE sets orphaned photos' `room_id = null` |
| `/api/properties/[id]/photos` | POST | Attach an existing photo to a property + room |
| `/api/properties/[id]/photos` | PATCH | Two modes: `{ photoId, roomId }` to move between rooms; `{ positions: [{id, position}] }` for bulk reorder |
| `/api/properties/[id]/photos` | DELETE | `{ photoId }` — remove a photo from the property |
| `/api/properties/[id]/batches` | GET, POST | List batches; POST creates batch + fires Inngest `batch/run` event; accepts optional `{ roomId }` to stage one room only |
| `/api/batches/[id]` | GET | Poll batch status + per-item URLs and statuses |

## Billing

| Route | Methods | Purpose |
|---|---|---|
| `/api/billing/checkout` | POST | Create Stripe Checkout session |
| `/api/billing/portal` | POST | Open Stripe Customer Portal |
| `/api/webhooks/stripe` | POST | Stripe webhook handler (signature verified); idempotent via `stripe_events_processed` |

## Inngest

| Route | Methods | Purpose |
|---|---|---|
| `/api/inngest` | GET, POST, PUT | Inngest serve handler — registers `batchRunFunction` + `webhookDeliveryFunction` |

## Admin

| Route | Methods | Purpose |
|---|---|---|
| `/api/admin/team` | POST | Create sub-account (child org) |
| `/api/admin/settings` | GET, PATCH | Org settings + active MLS boards |
| `/api/admin/disclosures/[id]/revoke` | POST | Revoke a disclosure (set `revoked_at`) |
| `/api/admin/compliance/export` | GET | Stream E&O PDF; `?period=90` or `?period=all` |

## External API v1

All `/api/v1/*` routes require `Authorization: Bearer isk_live_...`. Rate limited 60 req/min per key via Upstash.

| Route | Methods | Purpose |
|---|---|---|
| `/api/v1/keys` | GET, POST | List / create API keys (uses session auth, not Bearer) |
| `/api/v1/keys/[id]` | DELETE | Revoke a key |
| `/api/v1/properties` | GET, POST | List / create properties |
| `/api/v1/properties/[id]` | GET, PATCH | Get / update |
| `/api/v1/properties/[id]/photos` | POST | Upload photo (`{ filename, content_type, b64 }`) |
| `/api/v1/properties/[id]/batches` | GET, POST | List / create batches |
| `/api/v1/webhooks` | GET, POST | List / register webhook endpoints |
| `/api/v1/webhooks/[id]` | DELETE | Remove endpoint |
| `/api/v1/openapi.json` | GET | Static OpenAPI 3.0 spec |

## Public (no auth)

| Route | Purpose |
|---|---|
| `/api/brief/subscribe` | Newsletter subscribe |
| `/v/[code]` | AB 723 public disclosure page (Edge runtime) |
| `/docs` | Scalar interactive API reference |
