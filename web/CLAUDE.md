@AGENTS.md

---

# Web App — Architecture Reference

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| Framework | Next.js | 16.2.6 |
| React | React | 19.2.4 |
| Canvas | @xyflow/react | ^12 |
| Auth | next-auth (Google OAuth) | ^4 |
| Database | Neon serverless (`@neondatabase/serverless`) | ^1 |
| AI | `@google/genai` | ^2 |
| Styles | Tailwind CSS v4 + shadcn | — |
| Image resize | sharp | ^0.33 |

## Environment Variables (`.env.local`)

```
DATABASE_URL=              # Neon connection string
GEMINI_API_KEY=            # Google AI Studio key
GOOGLE_CLIENT_ID=          # Google OAuth app
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=              # e.g. http://localhost:3000
BLOB_READ_WRITE_TOKEN=     # Vercel Blob — provision via Vercel dashboard or CLI
```

`BLOB_READ_WRITE_TOKEN` enables Vercel Blob storage for photos and generation outputs. Without it the app falls back to storing base64 in Postgres (fine for local dev, not for production).

## Database Schema (`lib/db.ts`)

Schema is auto-migrated on first request via `migrate()`.

```
users               id (Google sub), email, name, image
photos              filename (PK), user_id TEXT DEFAULT '',
                    room_type, zone, default_prompt, mime_type,
                    image_url TEXT NULL,   -- Vercel Blob URL (preferred)
                    image_b64 TEXT NULL    -- legacy base64 fallback
sessions            id, owner_user_id → users, name, created_at,
                    link_access TEXT DEFAULT 'private',   -- 'private' | 'view' | 'edit'
                    share_password_hash TEXT NULL          -- PBKDF2 hash; NULL = no password
canvas_nodes        id, session_id → sessions, type, x, y, data (JSONB)
canvas_edges        id, session_id, source, source_handle, target, target_handle
generation_history  id, node_id → canvas_nodes, session_id → sessions,
                    output_url TEXT NULL,   -- Vercel Blob URL (preferred)
                    output_b64 TEXT NULL,   -- legacy base64 fallback
                    created_at
session_invites     id, session_id → sessions, email, role ('viewer'|'editor'), created_at
                    UNIQUE (session_id, email)
```

`canvas_nodes.data` schema by type:
- `photo`: `{ filename: string }`
- `generation`: `{ prompt, status ("idle"|"generating"|"done"|"error"), model?, outputUrl?, outputB64? }`

`outputUrl` (blob) and `outputB64` (legacy) are both persisted via JSONB merge; `photoUrl` and `outputImageUrl` are derived at load time from whichever is present — never stored.

## API Routes

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/sessions` | GET, POST | required | List / create sessions |
| `/api/sessions/[id]` | PATCH, DELETE | required | Rename / delete session |
| `/api/sessions/[id]/share` | GET, PATCH | owner only | Read/update link access, password, invite list |
| `/api/sessions/[id]/invites` | POST, DELETE | owner only | Add invite (or upsert role) / clear all invites |
| `/api/sessions/[id]/invites/[email]` | DELETE | owner only | Remove a single email invite |
| `/api/sessions/[id]/verify-password` | POST | none | Verify share password; sets httpOnly cookie on success |
| `/api/canvas` | GET | resolveAccess | Load canvas (public sessions allowed; password cookie checked) |
| `/api/canvas` | POST | required + write | Save full canvas state (debounced); respects canWrite from resolveAccess |
| `/api/generate` | POST | required + write | Run Gemini image generation for a node |
| `/api/photos` | GET | none | List photos (filename, room_type, zone, default_prompt) |
| `/api/photos` | POST | required | Upload a new photo (max 10 MB base64; idempotent by filename) |
| `/api/photos/[filename]` | GET | required | Serve photo as resized image (`?w=N`, max 1200 px) |
| `/api/setup` | GET | optional secret | One-time DB seeding: pipeline output → DB (uses `SETUP_SECRET` header if set) |
| `/api/history/[nodeId]` | GET | resolveAccess | Fetch generation history for a node (newest first) |
| `/api/history/[nodeId]/restore` | POST | required + write | Restore a history entry as the node's current output (swaps current → history) |

**`/api/canvas` POST** is a full-replace: upserts all current nodes (JSONB merge preserves `outputB64`), deletes missing ones, replaces all edges. Called after a 500 ms debounce on any canvas change.

**`/api/generate` POST** resolves the base photo and any ref images from the DB server-side (never trusts client). Body: `{ nodeId, prompt, model? }`. Limits: prompt max 4096 chars, max 4 ref images. Previous output (`outputUrl` or `outputB64`) is pushed to `generation_history` before overwriting. If `BLOB_READ_WRITE_TOKEN` is set, uploads the Gemini output to Vercel Blob and stores the URL; otherwise stores base64.

## Canvas Architecture (`components/canvas/`)

```
StageCanvas.tsx         Root canvas component — owns nodes/edges state, save, undo
                        Props: sessionId, readOnly? (disables all writes + hides MenuBar)
SourceNode.tsx          Photo node (type: "photo") — displays source image
GenerationNode.tsx      Generation node (type: "generation") — prompt textarea + generate button (slim)
DeletableEdge.tsx       Edge type with delete hover affordance
MenuBar.tsx             Bottom-center toolbar: upload, add node, save status (hidden in readOnly)
NodeInspectorPanel.tsx  Right-side panel (ReactFlow Panel) — prompt, model picker, output history,
                        download, delete; shown for any selected node; key=selectedNodeId resets state
SessionContext.ts       React context: { sessionId: string; readOnly: boolean }
```

**NodeInspectorPanel** mounts inside `<ReactFlow>` as a `<Panel position="top-right">` styled to span the full canvas height. Uses `key={selectedNodeId}` from the parent so all state resets when a different node is selected. Reads `readOnly` from `SessionContext` — hides model picker, Generate button, and Delete in read-only mode.

### Node Handles

**SourceNode** outputs:
- `photo` (right) — stone-400 color

**GenerationNode** inputs/outputs:
- `base` (left, 30% from top) — stone-400, required to generate
- `ref` (left, 60% from top) — acacia-400, optional reference images
- `output` (right) — sage-500, pipe result into another generation

Edge color: `base` edges → stone-400; `ref` edges → acacia-400 dashed.

### Undo

30-entry history (`history.current`). Snapshot taken before node/edge removals and drags. `Cmd/Ctrl+Z` replays. **No redo.**

### Canvas Save Flow

`StageCanvas` → 500 ms debounce on `nodes`/`edges` → POST `/api/canvas` → full upsert. Save state indicator: idle / saving / saved (2 s) / error.

## AI Models

Defined once in `lib/models.ts`:
- `GENERATION_MODELS` array — consumed by `NodeInspectorPanel` for the model picker UI
- `ALLOWED_MODEL_IDS` / `DEFAULT_MODEL_ID` — re-exported from the same file; `generate/route.ts` imports them (no separate list to keep in sync)

Current models:
| ID | Label | Notes |
|---|---|---|
| `gemini-3.1-flash-image-preview` | Gemini 3.1 Flash | Default; 4K output, fast |
| `gemini-3-pro-image-preview` | Gemini 3 Pro | Studio-quality |
| `gemini-2.5-flash-image` | Gemini 2.5 Flash | Stable, creative workflows |

Generation uses `responseModalities: ["IMAGE"]`. Has 1 automatic retry on empty candidates.

## Image Storage (`lib/storage.ts`)

`isBlobConfigured()` — returns true if `BLOB_READ_WRITE_TOKEN` is set.

`uploadToBlob(key, data, contentType)` — uploads `Buffer` or base64 string to Vercel Blob with public access. Key conventions:
- Photos: `photos/{userId}/{filename}`
- Generation outputs: `gen/{nodeId}/{timestamp}.jpg`
- Setup-seeded pipeline photos: `photos/setup/{filename}`

When blob is not configured, all routes fall back to base64-in-DB (existing behavior). Production **must** have `BLOB_READ_WRITE_TOKEN` set — base64 storage does not scale.

## Access Control (`lib/access.ts`)

`resolveAccess(sessionId, uid, email)` — central function used by canvas, generate, and history routes.

Returns `SessionAccessInfo`:
- `role`: `"owner" | "editor" | "viewer" | "none"`
- `canWrite`, `canRead` — derived booleans
- `needsPassword` — true when access came via a public link AND a password is set
- `passwordHash` — raw hash (needed to verify the password cookie server-side)

Resolution order:
1. Owner (`uid === owner_user_id`) — full access, password never required
2. Email invite — matched against `session_invites`; role is `viewer` or `editor`
3. `link_access = "view"` — viewer access; password check applies
4. `link_access = "edit"` — editor if authenticated, viewer if not; password check applies
5. `link_access = "private"` — `role: "none"`, no access

**Password system** — PBKDF2-SHA256, 210 000 iterations (OWASP 2023).
- `hashPassword(pw)` → `pbkdf2$iters$salt$hash`
- `verifyPassword(pw, stored)` → constant-time compare
- On success, `createPasswordCookie(sessionId, hash)` issues a stateless HMAC-SHA256 cookie tied to the session + hash (rotating the password auto-invalidates all cookies). Cookie name: `spw-{sessionId}`. 7-day TTL.
- `verifyPasswordCookie(cookieValue, sessionId, hash)` — verified server-side in both the page render and API routes.

## Session Sharing

Sharing is owner-only. The ShareModal (`components/ShareModal.tsx`) drives all sharing UI from the session header.

**Link access** (`sessions.link_access`):
- `private` — only owner and invited people
- `view` — anyone with the link can read
- `edit` — authenticated users can write; unauthenticated users can only read

**Email invites** (`session_invites`): owner adds individual emails with `viewer` or `editor` role. Invite lookup is by normalized email on every request — no registration required for the invitee.

**Password gate**: when a public-link session has `share_password_hash` set, unauthenticated (or non-invited) visitors accessing `/session/[id]` are redirected to `/session/[id]/password` (`PasswordForm.tsx`). On correct entry, a `spw-{id}` cookie is set and they are redirected back.

## Auth

Google OAuth via `next-auth`. `user.id` = Google `profile.sub`. Session exposed client-side via `useSession()`; server-side via `getServerSession(authOptions)`. Sign-in page is `/` (the `LoginGate` component). `lib/auth.ts` upserts user on every sign-in.

## File Upload Flow

1. Client reads file as base64 DataURL
2. POST `/api/photos` with `{ filename, mimeType, b64 }` — idempotent per `(user_id, filename)`
3. Server uploads to Vercel Blob (`photos/{uid}/{filename}`) and stores URL; falls back to base64 if blob not configured
4. `canvas_nodes` row created in the debounced canvas save
5. `/api/photos/[filename]?w=N` — redirects to `{blobUrl}?width=N` (CDN-served); falls back to sharp resize for legacy base64 photos

Drag-and-drop onto the canvas is supported (tracked with `dragCounter` ref to handle enter/leave quirks).

## CSS Tokens

All node corners use `--radius-node: 10px` (`:root` in `globals.css`) — change once to update all nodes.

Custom palette tokens (defined in `@theme` in `globals.css`): `sage-*`, `acacia-*`, `clay-*`, `moss-500`. Tailwind `stone-*` is the built-in neutral. **Do not introduce violet/purple/indigo/blue.**

## Dev Commands

```bash
cd web
npm run dev    # development server
npm run build  # production build
npm run lint   # eslint
```
