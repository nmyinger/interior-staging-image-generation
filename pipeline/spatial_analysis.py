"""
Step 2: Spatial analysis — per photo, text only.

Studies each photo individually to understand room geometry before any
furniture is placed. Output drives per-photo placement in the staging prompt.
"""
import json
from pathlib import Path
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, SOURCE_DIR, OUTPUTS_DIR

SPATIAL_PROMPT = """You are a professional interior designer analyzing a real estate photo to plan furniture placement before virtual staging.

Study this photo very carefully. Answer each question based only on what is actually visible in the image.

1. CAMERA POSITION: Where is the camera physically located in the room? Which wall or corner is it near? Which direction is it pointing? Be specific (e.g. "camera is in the southwest corner, pointing northeast toward the back wall").

2. VISIBLE WALLS: List every wall segment visible in the frame. For each: which direction it faces, approximate % of frame it occupies, and whether it is suitable for large furniture (sofa, TV stand, dresser, etc.). Note any obstructions like doors, windows, vents, or outlets.

3. ANCHOR WALL: Identify the single best wall for the primary furniture anchor (sofa + TV stand in living rooms, bed headboard in bedrooms, etc.). Explain why: longest unobstructed run, facing camera, good sight lines, etc.

4. CLEARANCE ZONES: List every area that must remain completely clear for traffic flow. Include doorways, hallway entrances, balcony/patio access, closet doors, and any passage between rooms. Specify approximate distance from obstruction that must stay clear.

5. FURNITURE ZONES: For each major furniture piece appropriate to this room type, specify exactly where it should go based on this room's geometry. Use wall names and frame positions (left/center/right, foreground/background).

6. FRAME COMPOSITION: Describe how furniture will appear in this specific frame. What lands in the foreground? What is in the background? Will the sofa face toward or away from camera? Will the TV wall be visible?

Respond ONLY with valid JSON. No explanation outside the JSON object.

{
  "camera_position": "precise description of camera location and direction",
  "visible_walls": [
    {"wall": "name/direction", "frame_coverage": "approx %", "furniture_suitable": true/false, "notes": "obstructions or features"}
  ],
  "anchor_wall": "which wall and why",
  "clearance_zones": [
    {"zone": "what it is", "clear_distance": "approx feet", "reason": "why it must stay clear"}
  ],
  "furniture_zones": {
    "piece_name": "exact placement — wall, distance from walls, orientation relative to camera"
  },
  "frame_composition": "how staged room will look in this frame — what is foreground, background, left, right"
}"""


def analyze_photo(photo_path: Path) -> dict:
    client = genai.Client(api_key=GEMINI_API_KEY)

    with open(photo_path, "rb") as f:
        image_data = f.read()

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            SPATIAL_PROMPT,
            types.Part.from_bytes(data=image_data, mime_type="image/jpeg"),
        ],
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=5000),
        ),
    )

    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    return json.loads(raw)


def analyze_all_photos(groups: dict[str, list[Path]]) -> dict[str, dict]:
    """Returns {filename: spatial_analysis_dict} for all non-skipped photos."""
    results = {}
    for room, paths in groups.items():
        out_dir = OUTPUTS_DIR / room
        out_dir.mkdir(parents=True, exist_ok=True)
        for path in paths:
            print(f"    Analyzing {path.name}...")
            analysis = analyze_photo(path)
            results[path.name] = analysis
            # save for inspection
            (out_dir / f"{path.stem}_spatial.json").write_text(
                json.dumps(analysis, indent=2)
            )
    return results


if __name__ == "__main__":
    from classify import classify_photos
    from collections import defaultdict

    classification = classify_photos()
    groups: dict[str, list[Path]] = defaultdict(list)
    for filename, room in classification.items():
        if room != "skip":
            groups[room].append(SOURCE_DIR / filename)

    results = analyze_all_photos({r: sorted(p) for r, p in groups.items()})
    for filename, analysis in results.items():
        print(f"\n=== {filename} ===")
        print(json.dumps(analysis, indent=2))
