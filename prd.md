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

## Pipeline (v5)

### Step 1 — Batch Analysis (1 API call, cached)
`analyze.py`: One Gemini text call with all stageable photos. Returns classify + spatial analysis for every photo simultaneously. Cached to `.cache/analysis.json` — free on re-runs.

### Step 2 — Apartment Manifest (1 API call, cached)
`manifest.py`: One Gemini text call with all photos. Returns a master palette (PART 1) and per-zone furniture identity spec (hex colors, materials, dims, silhouette) (PART 2). Per-zone manifest always includes the master palette prepended for apartment-wide style anchoring. Cached to `.cache/manifest.json`.

### Step 3 — Stage per Zone
`stage.py`: Per-zone image generation with output caching.
- **Heroes**: One per sub-area (kitchen hero + living room hero for open_plan; bathroom hero for bathroom_suite). `[manifest + spatial plan + empty room]` → staged; cached per file. For bathroom_suite, hero is always the bathroom interior (not closet).
- **Catalog**: Merged tile grid extracted from ALL zone heroes (one Gemini vision call per hero, merged into one grid). Cached to `.cache/catalog_{zone}.json`.
- **Rest**: `[empty room, sub-area staged hero, merged catalog]` — canvas first, identity reference second, tile supplement third; cached per file.
- **Bathroom closet**: `[empty closet, staged bathroom]` so doorway accessories match.

---

## Project Structure

```
pipeline/
├── main.py           # CLI: python3 main.py [--force]
├── analyze.py        # batch classify + spatial (1 call, cached)
├── manifest.py       # apartment-level manifest (1 call, cached)
├── stage.py          # zone-aware image generation with caching
├── config.py         # zones, model names, paths
└── requirements.txt
.cache/               # intermediate results (gitignored)
│   ├── analysis.json
│   ├── manifest.json
│   └── catalog_{zone}.json
outputs/
└── {zone}/           # open_plan, bedroom, bathroom_suite
    ├── manifest.md
    ├── catalog_grid.jpg
    └── {filename}_staged.jpg
.env                  # GEMINI_API_KEY (gitignored)
```

## Zone Grouping (physical connectivity)
- `open_plan` — kitchen + living_room (same connected space)
- `bedroom` — isolated room
- `bathroom_suite` — bathroom + bathroom_closet (closet overlooks bathroom)

## Cost Per Run
- Text calls: 2 total (analysis + manifest) ≈ $0.01
- Image calls: 1 per photo at $0.039 ≈ $0.35 for 9 photos
- Re-runs: $0 for text steps (cached); $0.039 only for any new/changed images

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
