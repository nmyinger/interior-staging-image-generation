# Database Schema

Source of truth: `lib/schema.ts` (Drizzle models) + `drizzle/migrations/`. Do not add columns here — read those files for full column definitions.

## Legacy tables — raw SQL via `lib/db.ts`

Managed by `migrate()` in `lib/db.ts`, not Drizzle. Schema lives in the migration calls inside that file.

| Table | Key columns | Notes |
|---|---|---|
| `users` | id (Google sub), email, name, image, default_org_id | `default_org_id` links to orgs |
| `photos` | filename (PK), user_id, org_id, sha256, mime_type, image_url, original_url | Blob URL in `image_url`; `original_url` = compliance copy |
| `sessions` | id, owner_user_id, name, org_id, link_access, share_password_hash | Canvas workspaces |
| `canvas_nodes` | id, session_id, type, x, y, data (JSONB) | type = "photo" or "generation" |
| `canvas_edges` | id, session_id, source, source_handle, target, target_handle | |
| `generation_history` | id, node_id, session_id, output_url, output_b64 | Per-node generation log |
| `session_invites` | id, session_id, email, role | role = 'viewer' or 'editor' |

## New tables — Drizzle (`lib/schema.ts`)

Migration: `drizzle/migrations/0001_new_tables.sql` for core tables; `0002_property_rooms.sql` for rooms.

| Table | Purpose |
|---|---|
| `orgs` | Multi-tenant org; `parent_org_id` self-ref for sub-accounts (brokerage → agent clients) |
| `org_members` | org_id + user_id + role ('owner'/'admin'/'member') |
| `billing_subscriptions` | One row per org; mirrors Stripe subscription state |
| `usage_events` | Append-only generation log for quota enforcement |
| `properties` | A listing/property being staged; belongs to an org |
| `property_photos` | Photos attached to a property; has `room_id → property_rooms`, `position` (sort order) |
| `property_rooms` | Rooms within a property; has `name`, `prompt` (furniture description), `position` |
| `batches` | A staging run; may cover all photos or a single room (`roomId` filter applied at creation) |
| `batch_items` | One row per photo in a batch; tracks `status`, `staged_url`, `original_url`, `error` |
| `disclosures` | Public AB 723 disclosure records; `short_code` → `/v/[code]` |
| `mls_rules` | Seeded watermark rules per MLS board code |
| `api_keys` | External API v1 keys; stored as SHA-256 hash |
| `webhook_endpoints` / `webhook_deliveries` | Outbound webhook config and delivery log |
| `stripe_events_processed` | Idempotency table for Stripe webhook handler |

## Key relationships

```
orgs ──< org_members >── users
orgs ──< properties ──< property_photos ──> photos (by filename)
                     ──< property_rooms
                     property_photos >── property_rooms (room_id)
properties ──< batches ──< batch_items ──> property_photos
orgs ──< billing_subscriptions
orgs ──< disclosures
```

## ID generation

Always use `genId()` from `lib/db.ts`. Never use `crypto.randomUUID()` for DB IDs.

## Org settings JSONB shape

```ts
{ activeMls: string[], defaultModel?: string, defaultMls?: string, pending_client_email?: string }
```
