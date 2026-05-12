# Virtual Staging Pipeline — PRD

## Goal
Validate that AI can produce visually consistent furniture across multiple angles of the same room, using a simple CLI pipeline. 11 photos of one apartment unit. If successful, this becomes the foundation of a SaaS product.

---

## Slice 1: CLI Consistency Proof

### Input
11 source photos in `Source Photos/`:
- **Kitchen** (3 angles): FLN_9371, FLN_9374, FLN_9377
- **Living Room** (3 angles): FLN_9380, FLN_9383, FLN_9386
- **Bedroom** (1 angle): FLN_9393
- **Bathroom + Closet Hall** (1 angle): FLN_9396
- **Bathroom** (1 angle): FLN_9399
- **Parking Garage**: FLN_9405 — SKIP
- **Building Lobby**: FLN_9411 — SKIP (already furnished)

### Output
Staged images in `outputs/{room}/`:
- `{original_filename}_staged.jpg` per photo
- `manifest.md` per room (furniture spec used)

### Success Criteria
- All 9 photos staged
- Kitchen angles 1–3 show the same bar stools
- Living room angles 1–3 show the same sofa, rug, and coffee table
- No hallucinated architectural changes (walls, floors, windows intact)

---

## API

**Model:** `gemini-3.1-flash-image-preview`
**SDK:** `google-genai` (Python)
**Key:** Set via `GEMINI_API_KEY` env var or `.env` file

Chosen over `gemini-2.5-flash-image` because:
- Tracks fidelity of up to 10 objects across multi-image input
- Gemini 3 reasoning core understands spatial context across angles
- Explicit object consistency feature built in

---

## Pipeline

### Step 1 — Classify
`classify.py`: Send all photos to Gemini (text-only, vision). Returns `{filename: room_type}` JSON.
Rooms: `kitchen`, `living_room`, `bedroom`, `bathroom`, `skip`.

### Step 2 — Manifest
`manifest.py`: For each room group, send all photos of that room in one call. Ask for a detailed Markdown furniture spec. Saved as `outputs/{room}/manifest.md`.

Manifest format — structured Markdown with dashed lists:
```
## Virtual Staging — {Room}

### Preserve exactly:
- [architectural elements]

### Add this furniture:
- [item: material, color, dimensions, placement]

### Style:
- [aesthetic, photography standards]
```

### Step 3 — Stage
`stage.py`: Reference-chain generation per room.
- **Angle 1**: `[manifest_text, empty_room_image]` → staged image
- **Angle 2+**: `[manifest_text, empty_room_image, staged_angle_1]` → staged image
  - Passing the first staged image as a visual reference is the key consistency mechanism.

Single-angle rooms (bedroom, bathroom): standard single-image edit call.

---

## Project Structure

```
pipeline/
├── main.py          # CLI entry: python main.py
├── classify.py
├── manifest.py
├── stage.py
├── config.py        # paths, skip list, model name
└── requirements.txt
outputs/
└── {room}/
    ├── manifest.md
    └── {filename}_staged.jpg
.env                 # GEMINI_API_KEY
```

---

## Prompt Engineering Rules

1. **Markdown with dashed lists** — most effective format for this model
2. **Preservation-first** — list what must not change before listing what to add
3. **Specific descriptions** — hex colors, materials, dimensions, placement direction
4. **Final-state phrasing** — "The room contains..." not "Add a sofa..."
5. **Photography anchors** — "professional real estate photography, natural window light, correct perspective and shadows"
6. **"This exact"** — when passing reference image, use "same furniture as shown in the reference image"

---

## Explicit Non-Goals (Slice 1)

- No web UI
- No mask / inpainting precision
- No style options or user configuration
- No async or parallel processing
- No cost tracking
- No retry logic
- No SaaS infrastructure

---

## Future Slices (Post-Validation)

- **Slice 2**: Multi-project support, style presets, CLI flags
- **Slice 3**: Web UI (Next.js), project management, download ZIP
- **Slice 4**: SaaS — auth, billing, Stripe, per-project pricing
