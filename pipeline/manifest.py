"""
Step 2: Generate one apartment-level style manifest + per-zone furniture specs.

Single call with all stageable photos. Produces:
- A master color/material palette for the whole apartment (cross-zone consistency)
- Per-zone furniture identity: specific pieces, hex colors, materials, dimensions

Cached to .cache/manifest.json. Only re-runs if cache is missing or force=True.
"""
import json
from pathlib import Path
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, MODEL_TEXT, SOURCE_DIR, CACHE_DIR, OUTPUTS_DIR, ZONES, SKIP_PHOTOS

MANIFEST_PROMPT = """You are a professional interior designer writing a virtual staging brief for an entire apartment.

I am showing you all the stageable photos of this apartment. Study the finishes across all rooms:
floor material and color, wall paint, cabinet tones, hardware finishes, ceiling height, natural light.

Write a staging brief with two parts:

## PART 1 — Apartment Master Palette
A single cohesive style that ties all rooms together. Specify:
- Design aesthetic (e.g. "modern Scandinavian with warm undertones")
- Primary wood tone: species + hex (e.g. "medium walnut #7B5E3A")
- Metal finish: (e.g. "matte black" or "brushed brass")
- Neutral base: wall/floor-complementing upholstery tone + hex
- Accent color: one pop color + hex
- Overall feel: (1 sentence)

## PART 2 — Per-Zone Furniture Specs
For each zone below, list every furniture piece to stage. For each piece:
- Type
- Color: hex code + description
- Material
- Approximate dimensions
- Key identifying style details (silhouette, leg style, etc.)
- Quantity

Zones to spec:
- **open_plan** (kitchen peninsula area + living/dining area — same connected space)
- **bedroom**
- **bathroom_suite** (bathroom interior + closet hallway — connected spaces)

Rules:
- Furniture must complement the existing finishes visible in the photos
- Keep pieces per zone to 5–8 maximum — clean, not cluttered
- The open_plan zone covers BOTH kitchen seating AND living/dining furniture
- The bathroom_suite covers accessories for BOTH the bathroom AND the closet
- No brand names
- Be specific enough that the same piece is recognizable from any camera angle

Output ONLY the Markdown brief. No preamble."""


def generate_manifest(force: bool = False) -> dict:
    """
    Returns {"master": str, "open_plan": str, "bedroom": str, "bathroom_suite": str}.
    Cached to .cache/manifest.json.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / "manifest.json"

    if not force and cache_path.exists():
        print("  (loaded from cache)")
        data = json.loads(cache_path.read_text())
        # also write per-zone markdown files for inspection
        _write_outputs(data)
        return data

    client = genai.Client(api_key=GEMINI_API_KEY)

    photos = sorted(p for p in SOURCE_DIR.iterdir() if p.name not in SKIP_PHOTOS)
    parts = [MANIFEST_PROMPT]
    for photo in photos:
        with open(photo, "rb") as f:
            data_bytes = f.read()
        parts.append(types.Part.from_bytes(data=data_bytes, mime_type="image/jpeg"))

    response = client.models.generate_content(
        model=MODEL_TEXT,
        contents=parts,
    )

    full_text = response.text.strip()

    # Split into master palette + per-zone sections
    result = {"full": full_text}
    for zone in ZONES:
        result[zone] = _extract_zone_section(full_text, zone)

    cache_path.write_text(json.dumps(result, indent=2))
    _write_outputs(result)
    return result


def _extract_zone_section(text: str, zone: str) -> str:
    """Extract the zone-specific section from the full manifest."""
    zone_display = zone.replace("_", " ")
    lines = text.split("\n")
    in_section = False
    section_lines = []
    for line in lines:
        lower = line.lower()
        if zone_display in lower or zone in lower:
            in_section = True
        elif in_section and line.startswith("## ") and zone_display not in lower and zone not in lower:
            break
        if in_section:
            section_lines.append(line)
    return "\n".join(section_lines).strip() if section_lines else text


def _write_outputs(data: dict) -> None:
    """Write manifest sections to outputs/ for inspection."""
    for zone in ZONES:
        out_dir = OUTPUTS_DIR / zone
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "manifest.md").write_text(data.get(zone, data.get("full", "")))
    (OUTPUTS_DIR / "manifest_full.md").write_text(data.get("full", ""))
