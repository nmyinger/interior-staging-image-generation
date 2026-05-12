"""
Step 3: Stage photos zone by zone, sequentially.

Each photo gets up to 3 inputs:
  1. Unfurnished photo  — the base; camera angle and architecture must be preserved
  2. Previous staged photo from this zone  — style/consistency reference (skip for first photo)
  3. Image-specific manifest  — only the furniture that belongs in this camera frame

Photos are staged in order so each one can reference the previously completed image.
Bathroom suite stages bathroom before closet so the doorway reference is available.

All outputs cached per file — re-runs skip existing staged images.
"""
import io
from pathlib import Path
from PIL import Image
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, MODEL_IMAGE, OUTPUTS_DIR, CACHE_DIR

# ── Prompts ───────────────────────────────────────────────────────────────────

STAGE_FIRST_PROMPT = """You are virtually staging a real estate photograph.

## Furniture for this camera frame:
{image_manifest}

## Camera angle:
Camera position: {camera_position}
Primary anchor wall: {anchor_wall}
Frame composition: {frame_composition}

Must remain clear:
{clearance_zones}

## Rules:
- Place ONLY the furniture listed above — nothing more, nothing less
- Preserve all architecture exactly: walls, floors, ceiling, windows, curtains, appliances, fixtures
- Do not change any view through windows or doors
- Furniture must sit on the floor, correctly scaled to the room
- Shadows and reflections must match the existing natural light
- Photorealistic, indistinguishable from a professional real estate photograph"""

STAGE_REF_PROMPT = """You are virtually staging a real estate photograph.

IMAGE 1 is the EMPTY ROOM — your base. Use its exact camera angle and lighting. Preserve all architecture.
IMAGE 2 is the SAME ZONE already staged from a different angle — use it for furniture style reference only. Match visible pieces in color, material, and finish. Do NOT copy IMAGE 2's camera angle, layout, or perspective.

## Furniture for this camera frame:
{image_manifest}

## Camera angle:
Camera position: {camera_position}
Primary anchor wall: {anchor_wall}
Frame composition: {frame_composition}

Must remain clear:
{clearance_zones}

## Rules:
- Place ONLY the furniture listed above
- IMAGE 1 is your canvas — its camera angle and perspective are authoritative
- Match any overlapping pieces from IMAGE 2 exactly in color, material, and silhouette
- Preserve all architecture from IMAGE 1: walls, floors, ceiling, windows, fixtures
- Do not change any view through windows or doors
- Shadows and reflections must match IMAGE 1's natural light
- Photorealistic, indistinguishable from a professional real estate photograph"""

CLOSET_PROMPT = """You are virtually staging a real estate photograph.

IMAGE 1 is the EMPTY HALLWAY/CLOSET — your base. Use its exact camera angle and lighting.
IMAGE 2 is the SAME APARTMENT'S BATHROOM, already staged. It is partially visible through the doorway — match its accessories (towels, bath mat, soap dispenser, plant) exactly.

## Furniture for this camera frame:
{image_manifest}

## Camera angle:
Camera position: {camera_position}
Anchor: {anchor_wall}
Frame composition: {frame_composition}

Must remain clear:
{clearance_zones}

## Rules:
- Stage the closet with the items listed above
- Bathroom accessories visible through the doorway must match IMAGE 2
- Preserve all architecture: walls, floors, door frames, closet rod, shelving
- Photorealistic, professional real estate photograph"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_spatial(s: dict) -> dict:
    cz = "\n".join(
        f"- {z['zone']}: {z.get('clear_distance', 'clear')} — {z.get('reason', '')}"
        for z in s.get("clearance_zones", [])
    )
    return {
        "camera_position": s.get("camera_position", "not specified"),
        "anchor_wall": s.get("anchor_wall", "not specified"),
        "frame_composition": s.get("frame_composition", "not specified"),
        "clearance_zones": cz or "none",
    }


def _generate(client, contents) -> bytes | None:
    for attempt in range(2):
        resp = client.models.generate_content(
            model=MODEL_IMAGE,
            contents=contents,
            config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
        )
        if not resp.candidates:
            if hasattr(resp, 'prompt_feedback'):
                print(f"    WARNING: no candidates — {resp.prompt_feedback}")
            return None
        for part in resp.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                return part.inline_data.data
        if attempt == 0:
            print(f"    retrying (model returned no image)...")
    return None


def _save(image_bytes: bytes, path: Path) -> None:
    Image.open(io.BytesIO(image_bytes)).save(path, "JPEG", quality=95)


def _out_path(photo_path: Path, zone: str) -> Path:
    return OUTPUTS_DIR / zone / f"{photo_path.stem}_staged.jpg"


# ── Main entry point ──────────────────────────────────────────────────────────

def stage_zone(
    zone: str,
    photo_paths: list[Path],
    manifest: str,
    analysis: dict,
    photo_manifests: dict,
) -> list[Path]:
    client = genai.Client(api_key=GEMINI_API_KEY)
    (OUTPUTS_DIR / zone).mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # For bathroom_suite, ensure bathroom is staged before closet
    if zone == "bathroom_suite":
        bathroom_photos = [p for p in photo_paths
                           if analysis.get(p.name, {}).get("room_type") == "bathroom"]
        closet_photos = [p for p in photo_paths
                         if analysis.get(p.name, {}).get("room_type") == "bathroom_closet"]
        ordered = bathroom_photos + closet_photos
    else:
        ordered = photo_paths

    staged: list[Path] = []
    last_staged: Path | None = None  # rolling reference for sequential consistency
    staged_bathroom: Path | None = None

    for photo in ordered:
        out = _out_path(photo, zone)
        room_type = analysis.get(photo.name, {}).get("room_type", "")
        sp = analysis.get(photo.name, {}).get("spatial", {})
        img_manifest = photo_manifests.get(photo.name, manifest)

        if out.exists():
            label = "[closet]" if room_type == "bathroom_closet" else "[photo] "
            print(f"    {label} {photo.name} (cached)")
            staged.append(out)
            last_staged = out
            if room_type == "bathroom":
                staged_bathroom = out
            continue

        with open(photo, "rb") as f:
            photo_data = f.read()

        if room_type == "bathroom_closet" and staged_bathroom:
            # Closet: base is empty closet, reference is staged bathroom
            print(f"    [closet] {photo.name}...")
            prompt = CLOSET_PROMPT.format(image_manifest=img_manifest, **_fmt_spatial(sp))
            with open(staged_bathroom, "rb") as f:
                bathroom_data = f.read()
            contents = [
                prompt,
                types.Part.from_bytes(data=photo_data, mime_type="image/jpeg"),
                types.Part.from_bytes(data=bathroom_data, mime_type="image/jpeg"),
            ]
        elif last_staged and last_staged.exists():
            # Subsequent photos: base + previous staged as style reference
            print(f"    [photo]  {photo.name}...")
            prompt = STAGE_REF_PROMPT.format(image_manifest=img_manifest, **_fmt_spatial(sp))
            with open(last_staged, "rb") as f:
                ref_data = f.read()
            contents = [
                prompt,
                types.Part.from_bytes(data=photo_data, mime_type="image/jpeg"),
                types.Part.from_bytes(data=ref_data, mime_type="image/jpeg"),
            ]
        else:
            # First photo: base only
            print(f"    [photo]  {photo.name}...")
            prompt = STAGE_FIRST_PROMPT.format(image_manifest=img_manifest, **_fmt_spatial(sp))
            contents = [
                prompt,
                types.Part.from_bytes(data=photo_data, mime_type="image/jpeg"),
            ]

        result = _generate(client, contents)
        if result:
            _save(result, out)
            print(f"    saved → {out.relative_to(out.parent.parent.parent)}")
            staged.append(out)
            last_staged = out
            if room_type == "bathroom":
                staged_bathroom = out
        else:
            print(f"    WARNING: generation failed for {photo.name}")

    return staged
