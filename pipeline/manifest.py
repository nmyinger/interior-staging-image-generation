"""
Step 2: Generate apartment-level manifest + per-photo furniture specs.

Two cached API calls:
1. Zone manifests — one call with all photos → master palette + per-zone furniture specs
2. Per-photo manifests — one cheap text call per photo → trimmed furniture list for
   exactly what should appear in that specific camera frame

Cached to .cache/manifest.json and .cache/photo_manifests.json.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, MODEL_TEXT, SOURCE_DIR, CACHE_DIR, OUTPUTS_DIR, ZONES, SKIP_PHOTOS, ROOM_TO_ZONE

MANIFEST_PROMPT = """You are a professional interior designer writing a virtual staging brief for an entire apartment.

I am showing you all the stageable photos of this apartment. Study the finishes across all rooms:
floor material and color, wall paint, cabinet tones, hardware finishes, ceiling height, natural light.

The staging style is BOHEMIAN: careless yet timeless, mixing exotic finds, vintage and antique furnishings, globally inspired textiles, layered rugs, eclectic collected objects, macramé, rattan, and woven materials. Rich jewel tones, earthy terracottas, and warm ochres alongside natural wood and brass. Every room should feel well-traveled and personal — as if assembled over years, not purchased in a single trip.

Write a staging brief with two parts:

## PART 1 — Apartment Master Palette
A single cohesive Bohemian palette that ties all rooms together. Specify:
- Design aesthetic (Bohemian — expand with 1 sentence of character)
- Primary wood tone: species + hex (e.g. "weathered teak #6B4C2A")
- Metal finish: (e.g. "antique brass" or "aged bronze")
- Neutral base: warm earthy upholstery tone + hex
- Accent color: one jewel tone or earthy pop color + hex
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

PER_PHOTO_PROMPT = """You are a staging coordinator trimming a furniture brief for one specific camera frame.

Full zone manifest:
{zone_manifest}

This photo's spatial analysis:
- Camera position: {camera_position}
- Anchor wall: {anchor_wall}
- Frame composition: {frame_composition}
- Furniture visible in this frame: {furniture_zones}

Output ONLY the furniture pieces that belong in this specific camera frame — the ones listed under "Furniture visible in this frame." For each piece include: type, exact color (hex), material, approximate dimensions, and any key style detail. Keep it to 3–5 items. No headers, no explanation, just the list."""


def _fetch_photo_manifest(args: tuple) -> tuple[str, str]:
    filename, prompt = args
    client = genai.Client(api_key=GEMINI_API_KEY)
    resp = client.models.generate_content(model=MODEL_TEXT, contents=[prompt])
    return filename, resp.text.strip()


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

    response = client.models.generate_content(model=MODEL_TEXT, contents=parts)

    full_text = response.text.strip()
    master = _extract_master_section(full_text)

    result = {"full": full_text, "master": master}
    for zone in ZONES:
        zone_section = _extract_zone_section(full_text, zone)
        result[zone] = f"{master}\n\n{zone_section}" if master != full_text else zone_section

    cache_path.write_text(json.dumps(result, indent=2))
    _write_outputs(result)
    return result


def generate_photo_manifests(analysis: dict, zone_manifests: dict, force: bool = False) -> dict:
    """
    Returns {filename: trimmed_manifest_str} — one per stageable photo.
    Each manifest lists only the furniture visible in that specific camera frame.
    Cached to .cache/photo_manifests.json.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / "photo_manifests.json"

    if not force and cache_path.exists():
        print("  (loaded from cache)")
        return json.loads(cache_path.read_text())

    work_items: list[tuple[str, str]] = []
    for filename, data in sorted(analysis.items()):
        rt = data.get("room_type", "skip")
        if rt == "skip":
            continue
        zone = ROOM_TO_ZONE.get(rt)
        if not zone:
            continue

        sp = data.get("spatial", {})
        fz = ", ".join(k.replace("_", " ") for k in sp.get("furniture_zones", {}).keys())

        prompt = PER_PHOTO_PROMPT.format(
            zone_manifest=zone_manifests.get(zone, zone_manifests.get("full", "")),
            camera_position=sp.get("camera_position", "not specified"),
            anchor_wall=sp.get("anchor_wall", "not specified"),
            frame_composition=sp.get("frame_composition", "not specified"),
            furniture_zones=fz or "place appropriately for this angle",
        )
        work_items.append((filename, prompt))

    result = {}
    with ThreadPoolExecutor(max_workers=len(work_items) or 1) as executor:
        futures = {executor.submit(_fetch_photo_manifest, item): item[0] for item in work_items}
        for future in as_completed(futures):
            filename, manifest = future.result()
            result[filename] = manifest
            print(f"    {filename}: {manifest[:80]}...")

    cache_path.write_text(json.dumps(result, indent=2))
    return result


def _extract_master_section(text: str) -> str:
    idx = text.find("## PART 2")
    if idx > 0:
        return text[:idx].strip()
    return text


def _extract_zone_section(text: str, zone: str) -> str:
    zone_display = zone.replace("_", " ")
    lines = text.split("\n")
    section_start = None
    section_end = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        heading_text = stripped.lstrip("#").strip().lower()
        if zone_display in heading_text or zone in heading_text:
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
    for zone in ZONES:
        out_dir = OUTPUTS_DIR / zone
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "manifest.md").write_text(data.get(zone, data.get("full", "")))
    (OUTPUTS_DIR / "manifest_full.md").write_text(data.get("full", ""))
