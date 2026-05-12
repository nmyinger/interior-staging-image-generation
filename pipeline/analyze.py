"""
Step 1: Batch analysis — classify + spatial analysis for all photos in ONE call.

Replaces separate classify.py + spatial_analysis.py passes.
No thinking mode (spatial reasoning at this level doesn't need it).
Results cached to .cache/analysis.json — only re-runs if cache is missing
or --force is passed.
"""
import json
from pathlib import Path
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, MODEL_TEXT, SOURCE_DIR, CACHE_DIR, SKIP_PHOTOS, ROOM_TO_ZONE

ANALYSIS_PROMPT = """You are analyzing real estate photos to classify each room and plan furniture placement.

For EACH photo (identified by its filename label), output a JSON object with:
1. room_type — one of: kitchen, living_room, bedroom, bathroom, bathroom_closet, skip
   - kitchen: kitchen area (peninsula/island, appliances, cabinets)
   - living_room: main living or dining area (hardwood/LVP floors, open space)
   - bedroom: bedroom (carpet or hard floors, no kitchen appliances)
   - bathroom: full bathroom interior (vanity, toilet, shower/tub visible)
   - bathroom_closet: hallway view showing both a bathroom entrance AND a closet
   - skip: parking garage, building lobby, amenity spaces, already-furnished communal areas

2. spatial — spatial analysis for furniture placement (skip this for room_type=skip):
   - camera_position: where the camera is and which direction it points (be precise)
   - anchor_wall: the single best wall for primary furniture (sofa/TV or bed headboard); explain why
   - clearance_zones: array of {zone, clear_distance, reason} for areas that must stay clear
   - furniture_zones: object mapping piece names to exact placement descriptions
   - frame_composition: how staged furniture will read in this specific frame

Respond with ONLY a valid JSON object. No markdown, no explanation.

{
  "FLN_9371_1.jpg": {
    "room_type": "kitchen",
    "spatial": { ... }
  },
  "FLN_9374_1.JPG": { ... }
}"""


def run_analysis(force: bool = False) -> dict:
    """
    Returns {filename: {room_type, spatial}} for all non-skipped photos.
    Loads from cache if available unless force=True.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / "analysis.json"

    if not force and cache_path.exists():
        print("  (loaded from cache — pass force=True to re-run)")
        return json.loads(cache_path.read_text())

    client = genai.Client(api_key=GEMINI_API_KEY)

    photos = sorted(p for p in SOURCE_DIR.iterdir() if p.name not in SKIP_PHOTOS)

    parts = [ANALYSIS_PROMPT]
    for photo in photos:
        with open(photo, "rb") as f:
            data = f.read()
        ext = photo.suffix.lower()
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
        parts.append(types.Part.from_bytes(data=data, mime_type=mime))
        parts.append(f"Filename: {photo.name}")

    response = client.models.generate_content(
        model=MODEL_TEXT,
        contents=parts,
    )

    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    result = json.loads(raw)
    cache_path.write_text(json.dumps(result, indent=2))
    return result


def group_by_zone(analysis: dict) -> dict[str, list[Path]]:
    """Returns {zone_name: [sorted photo paths]} excluding skipped photos."""
    from collections import defaultdict
    zones: dict[str, list[Path]] = defaultdict(list)
    for filename, data in analysis.items():
        room_type = data.get("room_type", "skip")
        if room_type == "skip":
            continue
        zone = ROOM_TO_ZONE.get(room_type)
        if zone:
            zones[zone].append(SOURCE_DIR / filename)
    return {zone: sorted(paths) for zone, paths in zones.items()}


if __name__ == "__main__":
    result = run_analysis(force=True)
    for filename, data in sorted(result.items()):
        print(f"  {filename:30s} → {data['room_type']}")
        if data.get("spatial"):
            print(f"    camera: {data['spatial'].get('camera_position', '')[:80]}")
