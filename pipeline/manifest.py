"""
Step 2: Generate a consistent furniture manifest (Markdown) for each room.
Sends all angles of a room together so Gemini can reason about the full space.
"""
from pathlib import Path
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, SOURCE_DIR, OUTPUTS_DIR, ROOM_DISPLAY

MANIFEST_PROMPT = """You are a professional interior designer creating a virtual staging brief for a real estate photographer.

I'm showing you {n} photos of the same empty {room}. Study the room carefully:
- Note the floor type, wall color, ceiling height, windows, natural light direction
- Note the architectural constraints (columns, alcoves, doors, outlets)
- Note the approximate dimensions and proportions

Then write a precise virtual staging manifest in this exact Markdown format:

## Virtual Staging — {room}

### Preserve exactly:
- (list every architectural element that must not be altered: walls, floors, ceiling, windows, curtains, light fixtures, appliances, view outside windows, etc.)

### Add this furniture:
- (list each furniture piece with: type, exact color description, material, approximate size, and placement direction relative to room features)
- (be specific enough that the same furniture would be recognizable from any camera angle)

### Style:
- (2–4 bullet points: design aesthetic, photography quality, lighting approach)

Rules:
- Furniture must be appropriate for the room size visible in the photos
- Choose a cohesive modern style that appeals to young urban renters
- No more than 6–8 furniture pieces total — keep it clean
- Do not mention brands or specific product names
- Output ONLY the Markdown manifest, no preamble or explanation"""


def generate_manifest(room: str, photo_paths: list[Path]) -> str:
    client = genai.Client(api_key=GEMINI_API_KEY)

    room_display = ROOM_DISPLAY.get(room, room.replace("_", " ").title())
    prompt = MANIFEST_PROMPT.format(n=len(photo_paths), room=room_display)

    parts = [prompt]
    for path in photo_paths:
        with open(path, "rb") as f:
            data = f.read()
        parts.append(types.Part.from_bytes(data=data, mime_type="image/jpeg"))

    response = client.models.generate_content(
        model="gemini-2.0-flash-lite",
        contents=parts,
    )

    manifest_text = response.text.strip()

    out_dir = OUTPUTS_DIR / room
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.md").write_text(manifest_text)

    return manifest_text


def generate_all_manifests(groups: dict[str, list[Path]]) -> dict[str, str]:
    manifests = {}
    for room, paths in groups.items():
        print(f"  Generating manifest for {room} ({len(paths)} photo(s))...")
        manifests[room] = generate_manifest(room, paths)
    return manifests


if __name__ == "__main__":
    from classify import classify_photos
    from collections import defaultdict

    classification = classify_photos()
    groups: dict[str, list[Path]] = defaultdict(list)
    for filename, room in classification.items():
        if room != "skip":
            groups[room].append(SOURCE_DIR / filename)

    manifests = generate_all_manifests(dict(groups))
    for room, text in manifests.items():
        print(f"\n{'='*60}")
        print(f"MANIFEST: {room}")
        print(text)
