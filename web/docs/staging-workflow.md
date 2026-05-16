# Property Staging Workflow

## User flow

1. User creates a **property** at `/properties/new` → lands on `/properties/[id]`
2. They add **rooms** (Living Room, Bedroom, etc.) — each room has a name and a furniture prompt
3. They **upload photos** into a room's drop zone → files go to Vercel Blob → recorded in `photos` table → linked to `property_photos` with `room_id`
4. They write a **prompt** per room (e.g. "modern sofa, floor lamp, oak coffee table")
5. They click **Stage** on a room → `POST /api/properties/[id]/batches` with `{ roomId }` → Inngest `batch/run` event fires
6. The page shows **inline loading states** per photo (Queued → Analyzing → Generating) — driven by `BatchPoller` polling every 3s
7. When staging completes, **staged images appear** in the Furnished column; a canvas is auto-created with the results

**Stage all rooms** button triggers the same flow without a `roomId` filter — all photos in the property are staged in one batch.

## Component map (`components/properties/`)

| Component | Role |
|---|---|
| `RoomCard.tsx` | Self-contained room card — upload zone, prompt, Stage button, sortable photo rows. Exports `PropertyPhoto` and `PropertyRoom` types. |
| `BatchProgress.tsx` | Exports `BatchPoller` (headless poller, renders null) and the visual `BatchProgress` component. |
| `StatusBadge.tsx` | 6-state status badge: draft / queued / analyzing / generating / done / failed |

## Drag-and-drop

- `@dnd-kit/core` + `@dnd-kit/sortable` (both installed)
- `DndContext` wraps the full room list in `page.tsx`
- Each photo row uses `useSortable` — dragging within a room **reorders** (persists via bulk `PATCH { positions }`)
- Each room body uses `useDroppable` — dragging a photo over a different room **moves** it (persists via `PATCH { photoId, roomId }`)
- `DragOverlay` in `page.tsx` renders the ghost thumbnail
- `draggable={false}` on all `<img>` elements prevents browser-native image drag from conflicting with @dnd-kit pointer events

## Batch pipeline (Inngest — `lib/jobs/batch-run.ts`)

```
batch/run event
  └─ load      — fetch batch_items; resolve photo URLs
  └─ manifest  — Gemini text call: generate furniture manifest per zone
  └─ stage     — parallel per photo: Gemini image generation
        └─ writes staged_url to batch_items
        └─ applies watermark (lib/watermark.ts)
        └─ creates disclosure record (lib/disclosures.ts)
  └─ terminal  — updates batch.status to 'done'/'failed'
               — fires batch/completed or batch/failed event
               — webhookDeliveryFunction sends to registered endpoints
```

Batch items reference `property_photos` rows. The `roomId` filter is applied at **batch creation** time — only the matching photos get `batch_items` rows. The pipeline itself is room-agnostic.

## Polling — how status reaches the UI

`BatchPoller` (headless component in `BatchProgress.tsx`):
- Mounts when a batch starts; polls `GET /api/batches/[id]` every 3s
- Calls `onUpdate(items)` on every poll → page updates `batchStatus` + `stagedUrl` per photo in local state
- Calls `onComplete(items)` once on terminal status → page removes the batch from `roomBatches`, triggers `autoCreateCanvas`
- Renders null; zero UI impact

Immediate feedback: when the user clicks Stage, the page immediately sets `batchStatus: "queued"` on all affected photos before the first poll, so the Furnished cell spinner appears instantly.

## Image serving

Never use raw Vercel Blob URLs in `<img>` tags.

| Content | Proxy | Width |
|---|---|---|
| Uploaded photos (by filename) | `/api/photos/[filename]?w=N` | 600 in room cards, 300 in drag overlay |
| AI-generated staged images | `/api/blob-proxy?url=<encoded>&w=N` | 600 in room cards |
| Property list thumbnails | `/api/photos/[filename]?w=200` | — |

Both proxies: Sharp resize → JPEG 85% → `Cache-Control: immutable, 1yr`. Auth-gated (session required).

## Auto-canvas creation

When a batch completes, `autoCreateCanvas()` in `page.tsx`:
1. Creates a new session linked to the property
2. Builds `canvas_nodes` — one SourceNode (original photo) + one GenerationNode (staged result) per item
3. POSTs to `/api/canvas`
4. Refreshes the canvases list on the page
