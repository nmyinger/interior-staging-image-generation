"""
Step 3: Generate a furniture identity manifest per room.

Focuses ONLY on what furniture looks like — type, color (with hex), material,
dimensions, style. Placement is intentionally excluded; that comes from the
per-photo spatial analysis.
"""
from pathlib import Path
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, SOURCE_DIR, OUTPUTS_DIR, ROOM_DISPLAY

MANIFEST_PROMPT = """You are a professional interior designer writing a virtual staging furniture spec.

I'm showing you {n} photo(s) of the same empty {room}. Study the room's finishes, color palette, and proportions.

Write a furniture identity specification — a precise description of each piece that will be staged. Focus ONLY on what the furniture looks like. Do NOT include placement or positioning (that is handled separately per photo).

For each piece, specify:
- Type (e.g. "3-seat sofa", "arc floor lamp")
- Color: specific hex code + plain description (e.g. "#B0A090 — warm greige linen")
- Material (e.g. "solid walnut", "brushed brass", "wool blend")
- Approximate dimensions
- Key style details that make it identifiable across views

Rules:
- Choose furniture that complements the room's existing finishes (note the floor color, wall color, cabinet colors if present)
- Modern style suited for young urban renters
- 5–8 pieces maximum — keep it clean and uncluttered
- No brand names
- Output ONLY the Markdown spec below, no preamble

## Furniture Identity — {room}

### Pieces:
- **[piece name]**: [color hex + description], [material], [dimensions], [style notes]
(repeat for each piece)

### Style:
- [2–3 bullet points on the overall aesthetic and photography standard]"""


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
        model="gemini-2.5-flash",
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
