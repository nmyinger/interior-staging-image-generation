"""
Step 2: Generate one apartment-level style manifest + per-zone furniture specs.

Single call with all stageable photos. Produces:
- A master color/material palette for the whole apartment (cross-zone consistency)
- Per-zone furniture identity: specific pieces, hex colors, materials, dimensions

Cached to .cache/manifest.json. Only re-runs if cache is missing or force=True.
"""
import json
import re
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
    Returns {"master": str, "full": str, "open_plan": str, "bedroom": str, "bathroom_suite": str}.
    Each zone value includes the master palette prepended for cross-zone consistency.
    Cached to .cache/manifest.json.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / "manifest.json"

    if not force and cache_path.exists():
        print("  (loaded from cache)")
        data = json.loads(cache_path.read_text())
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
    master = _extract_master_section(full_text)

    result = {"full": full_text, "master": master}
    for zone in ZONES:
        zone_section = _extract_zone_section(full_text, zone)
        # Prepend master palette so every image generation call has apartment-wide
        # style anchors (wood tone, metal finish, accent hex) alongside zone specifics.
        result[zone] = f"{master}\n\n{zone_section}" if master != full_text else zone_section

    cache_path.write_text(json.dumps(result, indent=2))
    _write_outputs(result)
    return result


def _extract_master_section(text: str) -> str:
    """Extract PART 1 (master palette) — everything before PART 2."""
    idx = text.find("## PART 2")
    if idx > 0:
        return text[:idx].strip()
    return text


def _extract_zone_section(text: str, zone: str) -> str:
    """Extract the zone-specific section using heading-based line parsing."""
    zone_display = zone.replace("_", " ")
    lines = text.split("\n")
    section_start = None
    section_end = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        heading_text = stripped.lstrip("#").strip().lower()
        is_zone_heading = zone_display in heading_text or zone in heading_text
        if is_zone_heading:
            if section_start is None:
                section_start = i
        elif section_start is not None and section_end is None:
            section_end = i
            break

    if section_start is None:
        return text
    end = section_end if section_end is not None else len(lines)
    return "\n".join(lines[section_start:end]).strip()


def _write_outputs(data: dict) -> None:
    """Write manifest sections to outputs/ for inspection."""
    for zone in ZONES:
        out_dir = OUTPUTS_DIR / zone
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "manifest.md").write_text(data.get(zone, data.get("full", "")))
    (OUTPUTS_DIR / "manifest_full.md").write_text(data.get("full", ""))
