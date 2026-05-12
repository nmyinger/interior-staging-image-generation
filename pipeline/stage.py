"""
Step 5: Stage photos using per-photo spatial plan + furniture references.

Hero photo (one per room):
  Staged with: [manifest text + spatial plan + empty room photo]
  This becomes the visual ground truth for that room.

Non-hero photos:
  Staged with: [empty room photo FIRST, catalog grid SECOND]
  The empty room is canvas. The catalog grid is identity reference only.
  The catalog grid is cropped furniture tiles on a neutral background —
  it does not look like a scene, so the model cannot copy its composition.

No reference chaining. No full-scene hero reference.
"""
from pathlib import Path
from google import genai
from google.genai import types
from PIL import Image
import io
from config import GEMINI_API_KEY, OUTPUTS_DIR, ROOM_DISPLAY

# ── Hero staging prompt ───────────────────────────────────────────────────────

HERO_PROMPT = """You are virtually staging a real estate photograph.

## Furniture to add — exact specifications:
{manifest}

## Placement for this camera angle:
Camera: {camera_position}
Anchor wall: {anchor_wall}
Frame composition: {frame_composition}

Furniture placement:
{furniture_zones}

Keep completely clear:
{clearance_zones}

## Rules:
- Stage THIS photo from its exact camera angle and perspective
- Preserve every architectural element: walls, floors, ceiling, windows, curtains, appliances, light fixtures
- Do NOT change any view through windows or doors
- Place furniture only on the floor within the room
- Scale, shadows and reflections must match the room's natural light
- Photorealistic, indistinguishable from a professional real estate photograph"""

# ── Non-hero staging prompt ───────────────────────────────────────────────────

CATALOG_PROMPT = """You are virtually staging a real estate photograph.

IMAGE 1 (first image) is the EMPTY ROOM TO STAGE. This defines the camera angle, perspective, lighting, and architecture. Stage it from exactly this viewpoint.

IMAGE 2 (second image) is a FURNITURE CATALOG — a reference sheet showing the exact furniture pieces to place. Study each labeled tile carefully: the silhouette, proportions, material, color, and style of each piece. These are the exact objects to reproduce in the room. Ignore the catalog's neutral background — it is not a scene.

## Placement for this camera angle:
Camera: {camera_position}
Anchor wall: {anchor_wall}
Frame composition: {frame_composition}

Furniture placement:
{furniture_zones}

Keep completely clear:
{clearance_zones}

## Accessory counts — use exactly these quantities:
{count_manifest}

## Rules:
- Use IMAGE 1's camera angle exclusively — do NOT adopt the perspective from the catalog
- Reproduce the furniture pieces from the catalog faithfully: same silhouette, same material, same color
- Preserve every architectural element in IMAGE 1: walls, floors, ceiling, windows, curtains, appliances, fixtures
- Do NOT change any view through windows or doors
- Scale, shadows and reflections must match IMAGE 1's natural light direction
- Photorealistic, indistinguishable from a professional real estate photograph"""


def _format_spatial(spatial: dict) -> dict:
    furniture_zones = "\n".join(
        f"- {piece}: {placement}"
        for piece, placement in spatial.get("furniture_zones", {}).items()
    )
    clearance_zones = "\n".join(
        f"- {z['zone']}: keep {z.get('clear_distance', 'clear')} clear — {z.get('reason', '')}"
        for z in spatial.get("clearance_zones", [])
    )
    return {
        "camera_position": spatial.get("camera_position", "not specified"),
        "anchor_wall": spatial.get("anchor_wall", "not specified"),
        "frame_composition": spatial.get("frame_composition", "not specified"),
        "furniture_zones": furniture_zones or "place appropriately per room type",
        "clearance_zones": clearance_zones or "none specified",
    }


def _format_counts(count_manifest: dict) -> str:
    if not count_manifest:
        return "no specific count constraints"
    return "\n".join(f"- {piece.replace('_', ' ')}: {count}" for piece, count in count_manifest.items())


def _save_output(image_bytes: bytes, out_path: Path) -> None:
    img = Image.open(io.BytesIO(image_bytes))
    img.save(out_path, "JPEG", quality=95)


def _generate_image(client, contents) -> bytes | None:
    response = client.models.generate_content(
        model="gemini-3.1-flash-image-preview",
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )
    for part in response.candidates[0].content.parts:
        if part.inline_data and part.inline_data.mime_type.startswith("image/"):
            return part.inline_data.data
    if response.text:
        print(f"    Model text: {response.text[:300]}")
    return None


def select_hero(photo_paths: list[Path], spatial_analyses: dict[str, dict]) -> Path:
    """
    Pick the hero photo: the one where the camera faces the anchor wall directly,
    giving the best full-room view of the primary furniture arrangement.
    Heuristic: prefer photos where spatial analysis indicates camera is pointing
    toward the anchor wall (not away from it). Falls back to first photo.
    """
    for path in photo_paths:
        spatial = spatial_analyses.get(path.name, {})
        camera = spatial.get("camera_position", "").lower()
        anchor = spatial.get("anchor_wall", "").lower()
        # if camera position description and anchor wall description share a direction
        # word that implies the camera is facing the anchor, prefer this photo
        facing_words = ["facing", "toward", "towards", "pointing", "northeast", "northwest",
                        "southeast", "southwest", "north", "south", "east", "west"]
        if any(w in camera for w in facing_words) and any(w in anchor for w in facing_words):
            return path
    return photo_paths[0]


def stage_hero(
    photo_path: Path,
    room: str,
    manifest: str,
    spatial: dict,
) -> Path | None:
    client = genai.Client(api_key=GEMINI_API_KEY)
    spatial_parts = _format_spatial(spatial)
    prompt = HERO_PROMPT.format(manifest=manifest, **spatial_parts)

    with open(photo_path, "rb") as f:
        image_data = f.read()

    image_bytes = _generate_image(client, [
        prompt,
        types.Part.from_bytes(data=image_data, mime_type="image/jpeg"),
    ])

    if image_bytes is None:
        print(f"    WARNING: No image returned for hero {photo_path.name}")
        return None

    out_dir = OUTPUTS_DIR / room
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{photo_path.stem}_staged.jpg"
    _save_output(image_bytes, out_path)
    print(f"    [hero]  Saved → {out_path.relative_to(out_path.parent.parent.parent)}")
    return out_path


def stage_with_catalog(
    photo_path: Path,
    room: str,
    spatial: dict,
    catalog_path: Path,
    count_manifest: dict,
) -> Path | None:
    client = genai.Client(api_key=GEMINI_API_KEY)
    spatial_parts = _format_spatial(spatial)
    prompt = CATALOG_PROMPT.format(
        count_manifest=_format_counts(count_manifest),
        **spatial_parts,
    )

    with open(photo_path, "rb") as f:
        empty_room_data = f.read()
    with open(catalog_path, "rb") as f:
        catalog_data = f.read()

    # Empty room FIRST (canvas), catalog SECOND (identity reference)
    image_bytes = _generate_image(client, [
        prompt,
        types.Part.from_bytes(data=empty_room_data, mime_type="image/jpeg"),
        types.Part.from_bytes(data=catalog_data, mime_type="image/jpeg"),
    ])

    if image_bytes is None:
        print(f"    WARNING: No image returned for {photo_path.name}")
        return None

    out_dir = OUTPUTS_DIR / room
    out_path = out_dir / f"{photo_path.stem}_staged.jpg"
    _save_output(image_bytes, out_path)
    print(f"    [ref]   Saved → {out_path.relative_to(out_path.parent.parent.parent)}")
    return out_path


def stage_room(
    room: str,
    photo_paths: list[Path],
    manifest: str,
    spatial_analyses: dict[str, dict],
    catalog_path: Path | None,
    count_manifest: dict,
) -> list[Path]:
    hero_path = select_hero(photo_paths, spatial_analyses)
    staged_paths = []

    for photo_path in photo_paths:
        spatial = spatial_analyses.get(photo_path.name, {})
        if not spatial:
            print(f"    WARNING: No spatial analysis for {photo_path.name}, skipping")
            continue

        print(f"    Staging {photo_path.name}...")

        if photo_path == hero_path:
            result = stage_hero(photo_path, room, manifest, spatial)
        elif catalog_path and catalog_path.exists():
            result = stage_with_catalog(photo_path, room, spatial, catalog_path, count_manifest)
        else:
            # fallback: hero not available, use v2 approach
            result = stage_hero(photo_path, room, manifest, spatial)

        if result:
            staged_paths.append(result)

    return staged_paths


def stage_all_rooms(
    groups: dict[str, list[Path]],
    manifests: dict[str, str],
    spatial_analyses: dict[str, dict],
    catalogs: dict[str, tuple[Path | None, dict]],
) -> dict[str, list[Path]]:
    results = {}
    for room, paths in groups.items():
        room_display = ROOM_DISPLAY.get(room, room)
        print(f"  Staging {room_display} ({len(paths)} photo(s))...")
        catalog_path, count_manifest = catalogs.get(room, (None, {}))
        results[room] = stage_room(
            room, paths, manifests[room], spatial_analyses, catalog_path, count_manifest
        )
    return results
