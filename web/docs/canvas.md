# Canvas — Architecture & Flow

## User flow

1. User creates a **session** (canvas workspace) from `/properties/[id]` or `/session` list
2. They open the canvas at `/canvas/[id]` — `StageCanvas` loads nodes + edges from `/api/canvas`
3. They drag a **SourceNode** (photo) onto the canvas and connect it to a **GenerationNode** via the `photo → base` handle
4. In the right panel (`NodeInspectorPanel`) they write a prompt and pick a model, then click Generate
5. `POST /api/generate` calls Gemini with the source photo + prompt → returns a staged image URL
6. The GenerationNode displays the output; the user can connect it to another GenerationNode as a reference image (`ref` handle) for iterative refinement
7. Canvas state auto-saves on every change via debounced `POST /api/canvas`

## File map (`components/canvas/`)

| File | Role |
|---|---|
| `StageCanvas.tsx` | Root — owns nodes/edges state, save, undo/redo |
| `SourceNode.tsx` | Photo input node (type: `"photo"`) |
| `GenerationNode.tsx` | AI output node (type: `"generation"`) |
| `DeletableEdge.tsx` | Edge with delete hover affordance |
| `MenuBar.tsx` | Bottom-center floating toolbar (add node, undo, zoom) |
| `NodeInspectorPanel.tsx` | Right panel — prompt, model picker, generation history, download |
| `SessionContext.ts` | `{ sessionId: string; readOnly: boolean }` — consumed by all canvas components |

## Node handles

**SourceNode** (stone-400):
- `photo` — right side, output only

**GenerationNode**:
- `base` — left top (stone-400, required) — primary photo input
- `ref` — left bottom (acacia-400, optional) — reference/style image
- `output` — right (sage-500) — connect to another GenerationNode's `base` or `ref`

## Access control

`resolveAccess(sessionId, uid, email)` from `lib/access.ts`:
- Returns `{ role, canWrite, canRead, needsPassword }`
- Resolution order: owner → email invite → `link_access` ('view'/'edit') → none
- Password: PBKDF2-SHA256, 210k iterations; cookie `spw-{sessionId}`, 7-day TTL
- Read-only sessions render the canvas without the inspector panel or generate button

## Quota enforcement

Before every Gemini call, `canGenerate(userId)` from `lib/billing.ts` is checked. Returns 402 `{ error: "quota_exceeded" }` when the org's generation limit is reached. The canvas client should surface an upgrade prompt on 402.

## Generation history

Every successful generation writes a row to `generation_history`. `NodeInspectorPanel` fetches `GET /api/history/[nodeId]` and shows thumbnails. `POST /api/history/[nodeId]/restore` swaps a node's output back to a prior result.

## Auto-save invariant

Canvas state is saved optimistically — the client never waits for the save to complete before allowing further edits. If the user closes the tab mid-debounce, the last save wins. This is intentional; canvas is a scratch workspace, not a versioned document.
