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
DATABASE_URL=           # Neon connection string
GEMINI_API_KEY=         # Google AI Studio key
GOOGLE_CLIENT_ID=       # Google OAuth app
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=           # e.g. http://localhost:3000
```

## Database Schema (`lib/db.ts`)

Schema is auto-migrated on first request via `migrate()`.

```
users               id (Google sub), email, name, image
photos              filename (PK), room_type, zone, default_prompt, image_b64, mime_type
sessions            id, owner_user_id → users, name, created_at
canvas_nodes        id, session_id → sessions, type, x, y, data (JSONB)
canvas_edges        id, session_id, source, source_handle, target, target_handle
generation_history  id, node_id → canvas_nodes, session_id → sessions, output_b64 TEXT, created_at
```

`canvas_nodes.data` schema by type:
- `photo`: `{ filename: string }`
- `generation`: `{ prompt, status ("idle"|"generating"|"done"|"error"), model?, outputB64? }`

`outputB64` is persisted; `photoUrl` and `outputImageUrl` are derived at load time and never stored.

## API Routes

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/sessions` | GET, POST | required | List / create sessions |
| `/api/sessions/[id]` | PATCH, DELETE | required | Rename / delete session |
| `/api/canvas` | GET, POST | required | Load / save full canvas state (debounced) |
| `/api/generate` | POST | required | Run Gemini image generation for a node |
| `/api/photos` | GET, POST | none | List photos / upload new photo |
| `/api/photos/[filename]` | GET | none | Serve photo as resized image (`?w=N`) |
| `/api/setup` | GET | none | One-time DB seeding (pipeline output → DB) |
| `/api/history/[nodeId]` | GET | required | Fetch generation history for a node (newest first) |
| `/api/history/[nodeId]/restore` | POST | required | Restore a history entry as the node's current output (swaps current → history) |

**`/api/canvas` POST** is a full-replace: upserts all current nodes, deletes missing ones, replaces all edges. Called after a 500 ms debounce on any canvas change.

**`/api/generate` POST** resolves the base photo and any ref images from the DB server-side (never trusts client). Body: `{ nodeId, prompt, model? }`.

## Canvas Architecture (`components/canvas/`)

```
StageCanvas.tsx         Root canvas component — owns nodes/edges state, save, undo
SourceNode.tsx          Photo node (type: "photo") — displays source image
GenerationNode.tsx      Generation node (type: "generation") — prompt textarea + generate button (slim)
DeletableEdge.tsx       Edge type with delete hover affordance
MenuBar.tsx             Bottom-center toolbar: upload, add node, save status
NodeInspectorPanel.tsx  Right-side panel (ReactFlow Panel) — prompt, model picker, output history,
                        download, delete; shown for any selected node; key=selectedNodeId resets state
SessionContext.ts       React context carrying sessionId down to nodes
```

**NodeInspectorPanel** mounts inside `<ReactFlow>` as a `<Panel position="top-right">` styled to span the full canvas height. Uses `key={selectedNodeId}` from the parent so all state resets when a different node is selected.

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

Defined in two places that **must stay in sync**:
- `lib/models.ts` — `GENERATION_MODELS` array (used by `NodeInspectorPanel`)
- `app/api/generate/route.ts` — `ALLOWED_MODEL_IDS` array

Current models:
| ID | Label | Notes |
|---|---|---|
| `gemini-3.1-flash-image-preview` | Gemini 3.1 Flash | Default; 4K output, fast |
| `gemini-3-pro-image-preview` | Gemini 3 Pro | Studio-quality |
| `gemini-2.5-flash-image` | Gemini 2.5 Flash | Stable, creative workflows |

Generation uses `responseModalities: ["IMAGE"]`. Has 1 automatic retry on empty candidates.

## Auth

Google OAuth via `next-auth`. `user.id` = Google `profile.sub`. Session exposed client-side via `useSession()`; server-side via `getServerSession(authOptions)`. Sign-in page is `/` (the `LoginGate` component). `lib/auth.ts` upserts user on every sign-in.

## File Upload Flow

1. Client reads file as base64 DataURL
2. POST `/api/photos` with `{ filename, mimeType, b64 }` — idempotent (skips if filename exists)
3. `canvas_nodes` row created in the debounced canvas save
4. `/api/photos/[filename]?w=N` serves the photo resized via `sharp`

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
