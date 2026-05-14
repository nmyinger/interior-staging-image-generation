# Interior Staging Image Generation

AI-powered virtual staging tool. Two independent parts:

## Repo Structure

```
pipeline/          Python CLI — batch stages 11 apartment photos via Gemini
web/               Next.js web app — canvas UI for interactive staging
Source Photos/     11 source JPEGs (input for the pipeline)
prd.md             Product requirements document (Slice 1 = CLI, future = SaaS)
.env.example       Only GEMINI_API_KEY needed for the pipeline
```

## Pipeline (`pipeline/`)

Python CLI that stages all photos in 3 cached steps:

| File | Role |
|---|---|
| `main.py` | Entry point: `python3 main.py [--force]` |
| `analyze.py` | Batch classify + spatial analysis (1 Gemini text call, cached) |
| `manifest.py` | Apartment-wide furniture manifest (1 Gemini text call, cached) |
| `stage.py` | Zone-aware image generation with per-file output caching |
| `config.py` | Zone definitions, model names, file paths |

**Zones:** `open_plan` (kitchen + living room), `bedroom`, `bathroom_suite` (bathroom + closet).

**Caching:** `.cache/analysis.json`, `.cache/manifest.json`, `.cache/catalog_{zone}.json`. Delete `.cache/` or use `--force` to re-run.

**Models:** `gemini-3.1-flash-image-preview` (default), SDK: `google-genai` (Python).

**Outputs:** `outputs/{zone}/` — `{filename}_staged.jpg`, `manifest.md`, `catalog_grid.jpg`.

**Cost:** ~$0.35/full run; $0 for cached text steps on re-runs.

## Web App (`web/`)

See `web/CLAUDE.md` for full details.

Run: `cd web && npm run dev` (requires `.env.local` — see `web/CLAUDE.md`).
