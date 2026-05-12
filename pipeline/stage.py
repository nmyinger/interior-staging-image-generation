"""
Step 3: Stage each photo using the room manifest + reference chaining.

For rooms with multiple angles:
- Angle 1: [manifest, empty_room] → staged
- Angle 2+: [manifest, empty_room, staged_angle_1] → staged
  (reference-chaining: the model sees the already-staged version for consistency)

For single-angle rooms: [manifest, empty_room] → staged
"""
from pathlib import Path
from google import genai
from google.genai import types
from PIL import Image
import io
from config import GEMINI_API_KEY, OUTPUTS_DIR, ROOM_DISPLAY

STAGE_PROMPT_SINGLE = """{manifest}

---

This is the empty room to stage. Apply the furniture spec above exactly as written.

Critical rules:
- Do NOT alter any architectural elements (walls, floors, ceiling, windows, curtains, appliances, fixtures)
- Do NOT change the view visible through the windows
- Place furniture only on the floor within the room
- Match the existing natural light direction for furniture shadows
- Output a photorealistic image indistinguishable from a professional real estate photograph"""

STAGE_PROMPT_WITH_REFERENCE = """{manifest}

---

The FIRST IMAGE is the empty room to stage from this angle.
The SECOND IMAGE is the same room already staged from a different angle — use it as a visual reference to ensure the furniture is identical (same pieces, same colors, same materials).

Critical rules:
- Reproduce the exact same furniture pieces visible in the reference image, shown from this new camera angle
- Do NOT alter any architectural elements (walls, floors, ceiling, windows, curtains, appliances, fixtures)
- Do NOT change the view visible through the windows
- Match the existing natural light direction for furniture shadows
- Output a photorealistic image indistinguishable from a professional real estate photograph"""


def _load_image_bytes(path: Path) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _save_output_image(image_data: bytes, out_path: Path) -> None:
    img = Image.open(io.BytesIO(image_data))
    img.save(out_path, "JPEG", quality=95)


def stage_room(room: str, photo_paths: list[Path], manifest: str) -> list[Path]:
    client = genai.Client(api_key=GEMINI_API_KEY)
    out_dir = OUTPUTS_DIR / room
    out_dir.mkdir(parents=True, exist_ok=True)

    staged_paths = []
    reference_image_bytes: bytes | None = None

    for i, photo_path in enumerate(photo_paths):
        print(f"    Staging {photo_path.name} ({i+1}/{len(photo_paths)})...")

        empty_bytes = _load_image_bytes(photo_path)

        if reference_image_bytes is None:
            prompt = STAGE_PROMPT_SINGLE.format(manifest=manifest)
            contents = [
                prompt,
                types.Part.from_bytes(data=empty_bytes, mime_type="image/jpeg"),
            ]
        else:
            prompt = STAGE_PROMPT_WITH_REFERENCE.format(manifest=manifest)
            contents = [
                prompt,
                types.Part.from_bytes(data=empty_bytes, mime_type="image/jpeg"),
                types.Part.from_bytes(data=reference_image_bytes, mime_type="image/jpeg"),
            ]

        response = client.models.generate_content(
            model="gemini-3.1-flash-image-preview",
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )

        image_bytes = None
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                image_bytes = part.inline_data.data
                break

        if image_bytes is None:
            print(f"    WARNING: No image returned for {photo_path.name}. Text: {response.text[:200]}")
            continue

        stem = photo_path.stem
        out_path = out_dir / f"{stem}_staged.jpg"
        _save_output_image(image_bytes, out_path)
        staged_paths.append(out_path)
        print(f"    Saved → {out_path.relative_to(out_path.parent.parent.parent)}")

        # first staged image becomes the reference for all subsequent angles
        if reference_image_bytes is None:
            reference_image_bytes = image_bytes

    return staged_paths


def stage_all_rooms(
    groups: dict[str, list[Path]],
    manifests: dict[str, str],
) -> dict[str, list[Path]]:
    results = {}
    for room, paths in groups.items():
        room_display = ROOM_DISPLAY.get(room, room)
        print(f"  Staging {room_display} ({len(paths)} photo(s))...")
        results[room] = stage_room(room, paths, manifests[room])
    return results
