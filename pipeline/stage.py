"""
Step 3–5: Stage photos zone by zone.

For each zone:
  Heroes     — one per sub-area (kitchen hero + living room hero for open_plan).
               Staged with [manifest + spatial plan + empty room].
               Output cached; skipped if already exists.
  Catalog    — per-object tile grid extracted from all heroes merged (cached).
  Rest       — staged with [empty room, sub-area staged hero, catalog grid]:
               empty room is the canvas; hero is the identity reference;
               catalog is a labeled supplement.
               Output cached; skipped if already exists.
  Bathroom closet: staged with [empty closet, staged bathroom] so doorway
               accessories match.
"""
import json
import math
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import io
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, MODEL_TEXT, MODEL_IMAGE, OUTPUTS_DIR, CACHE_DIR, ZONES

# ── Prompts ───────────────────────────────────────────────────────────────────

HERO_PROMPT = """You are virtually staging a real estate photograph.

## Furniture spec for this zone:
{manifest}

## Placement for this specific camera angle:
Camera position: {camera_position}
Primary anchor wall: {anchor_wall}
Frame composition: {frame_composition}

Furniture placement:
{furniture_zones}

Must remain clear:
{clearance_zones}

## Non-negotiable rules:
- Stage THIS photo from its exact camera angle — do not alter the viewpoint
- Preserve all architecture: walls, floors, ceiling, windows, curtains, appliances, fixtures, baseboards
- Do not change any view through windows or doors
- Furniture must sit on the floor, correctly scaled to the room
- Shadows and reflections must match the existing natural light
- Output must be photorealistic, indistinguishable from a professional real estate photograph"""

CATALOG_PROMPT = """You are virtually staging a real estate photograph.

IMAGE 1 is the EMPTY ROOM TO STAGE. Use its exact camera angle, perspective, and lighting. This is your canvas.
IMAGE 2 is the SAME ZONE already staged from a different angle. Match the furniture EXACTLY — same silhouette, color, material, and finish. Do NOT copy IMAGE 2's camera angle or perspective.
IMAGE 3 is a FURNITURE CATALOG — labeled tiles showing each piece for precise silhouette and proportion reference.

## Placement for this specific camera angle:
Camera position: {camera_position}
Primary anchor wall: {anchor_wall}
Frame composition: {frame_composition}

Furniture placement:
{furniture_zones}

Must remain clear:
{clearance_zones}

## Accessory counts — use exactly these:
{count_manifest}

## Non-negotiable rules:
- Use IMAGE 1's camera angle exclusively — do not copy IMAGE 2's perspective
- Match IMAGE 2's furniture identity: same silhouette, material, color, finish for every piece
- Reproduce each catalog tile faithfully: same proportions and style
- Preserve all architecture in IMAGE 1: walls, floors, ceiling, windows, curtains, appliances, fixtures
- Do not change any view through windows or doors
- Shadows and reflections must match IMAGE 1's natural light
- Photorealistic, indistinguishable from a professional real estate photograph"""

CLOSET_PROMPT = """You are virtually staging a real estate photograph.

IMAGE 1 is the EMPTY HALLWAY/CLOSET to stage. Use its exact camera angle and perspective.
IMAGE 2 is the SAME APARTMENT'S BATHROOM, already staged. The bathroom is partially visible through the doorway in IMAGE 1 — the staged bathroom accessories (towels, bath mat, soap dispenser, plant) must match what is visible through that doorway.

## Placement for this specific camera angle:
Camera position: {camera_position}
Anchor: {anchor_wall}
Frame composition: {frame_composition}

Closet staging:
{furniture_zones}

Must remain clear:
{clearance_zones}

## Rules:
- Stage the closet with the items described in the furniture zones
- The bathroom accessories visible through the doorway must be consistent with IMAGE 2
- Preserve all architecture: walls, floors, door frames, closet rod, shelving
- Photorealistic, professional real estate photograph"""

# ── Catalog grid builder ──────────────────────────────────────────────────────

BBOX_PROMPT = """Identify every distinct furniture or decor piece in this staged room image.
For each, give a bounding box and a short label (sofa, accent_chair, coffee_table, tv_console, arc_lamp, bar_stool, dining_chair, dining_table, side_table, dresser, bed, nightstand, rug, plant, throw_pillow, bath_mat, towel_set, etc.)
Exclude walls, floors, ceiling, windows, and fixed architecture.

Output ONLY valid JSON:
{
  "pieces": [{"label": "sofa", "x1": 120, "y1": 450, "x2": 880, "y2": 920}],
  "counts": {"sofa": 1, "accent_chair": 2}
}
Coordinates are 0–1000 scale, (0,0) = top-left."""

TILE_SIZE, TILE_PAD, LABEL_H = 300, 12, 32
GRID_BG, TILE_BG = (245, 245, 242), (255, 255, 255)


def _build_catalog(hero_paths: list[Path], zone: str) -> tuple[Path | None, dict]:
    """Build a merged catalog grid from one or more staged hero images."""
    cache_path = CACHE_DIR / f"catalog_{zone}.json"
    catalog_img_path = OUTPUTS_DIR / zone / "catalog_grid.jpg"

    if cache_path.exists() and catalog_img_path.exists():
        data = json.loads(cache_path.read_text())
        return catalog_img_path, data.get("counts", {})

    client = genai.Client(api_key=GEMINI_API_KEY)
    all_pieces = []
    all_counts: dict = {}

    for hero_path in hero_paths:
        with open(hero_path, "rb") as f:
            hero_bytes = f.read()

        resp = client.models.generate_content(
            model=MODEL_TEXT,
            contents=[BBOX_PROMPT, types.Part.from_bytes(data=hero_bytes, mime_type="image/jpeg")],
        )
        raw = re.sub(r'^```(?:json)?\s*', '', resp.text.strip())
        raw = re.sub(r'\s*```$', '', raw).strip()
        parsed = json.loads(raw)

        pieces = parsed.get("pieces", [])
        counts = parsed.get("counts", {})
        for p in pieces:
            p["_hero_path"] = str(hero_path)
        all_pieces.extend(pieces)
        for k, v in counts.items():
            all_counts[k] = all_counts.get(k, 0) + v

    merged = {"pieces": all_pieces, "counts": all_counts}
    cache_path.write_text(json.dumps(merged, indent=2))

    if not all_pieces:
        return None, all_counts

    tiles = []
    for p in all_pieces:
        hero_img = Image.open(p["_hero_path"])
        W, H = hero_img.size
        m = max(20, int((p["x2"] - p["x1"]) / 1000 * W * 0.08))
        x1 = max(0, int(p["x1"] / 1000 * W) - m)
        y1 = max(0, int(p["y1"] / 1000 * H) - m)
        x2 = min(W, int(p["x2"] / 1000 * W) + m)
        y2 = min(H, int(p["y2"] / 1000 * H) + m)
        crop = hero_img.crop((x1, y1, x2, y2))
        if crop.width < 20 or crop.height < 20:
            continue
        inner = TILE_SIZE - TILE_PAD * 2
        crop.thumbnail((inner, inner), Image.LANCZOS)
        tile = Image.new("RGB", (TILE_SIZE, TILE_SIZE + LABEL_H), TILE_BG)
        tile.paste(crop, ((TILE_SIZE - crop.width) // 2, TILE_PAD + (inner - crop.height) // 2))
        draw = ImageDraw.Draw(tile)
        draw.rectangle([(0, TILE_SIZE), (TILE_SIZE, TILE_SIZE + LABEL_H)], fill=(225, 225, 222))
        label = p["label"].replace("_", " ").upper()
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 12)
        except Exception:
            font = ImageFont.load_default()
        bb = draw.textbbox((0, 0), label, font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        draw.text(((TILE_SIZE - tw) // 2, TILE_SIZE + (LABEL_H - th) // 2), label, fill=(60, 60, 60), font=font)
        tiles.append(tile)

    if not tiles:
        return None, all_counts

    cols = min(4, len(tiles))
    rows = math.ceil(len(tiles) / cols)
    gap = 10
    gw = cols * (TILE_SIZE + gap) + gap
    gh = rows * (TILE_SIZE + LABEL_H + gap) + gap
    grid = Image.new("RGB", (gw, gh), GRID_BG)
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        grid.paste(t, (gap + c * (TILE_SIZE + gap), gap + r * (TILE_SIZE + LABEL_H + gap)))

    (OUTPUTS_DIR / zone).mkdir(parents=True, exist_ok=True)
    grid.save(catalog_img_path, "JPEG", quality=92)
    print(f"    Catalog: {len(tiles)} tiles → {catalog_img_path.name}")
    return catalog_img_path, all_counts

# ── Core staging ──────────────────────────────────────────────────────────────

def _fmt_spatial(s: dict) -> dict:
    fz = "\n".join(f"- {k}: {v}" for k, v in s.get("furniture_zones", {}).items())
    cz = "\n".join(
        f"- {z['zone']}: {z.get('clear_distance','clear')} — {z.get('reason','')}"
        for z in s.get("clearance_zones", [])
    )
    return {
        "camera_position": s.get("camera_position", "not specified"),
        "anchor_wall": s.get("anchor_wall", "not specified"),
        "frame_composition": s.get("frame_composition", "not specified"),
        "furniture_zones": fz or "place appropriately",
        "clearance_zones": cz or "none",
    }


def _fmt_counts(counts: dict) -> str:
    if not counts:
        return "no specific count constraints"
    return "\n".join(f"- {k.replace('_',' ')}: {v}" for k, v in counts.items())


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


def _select_hero(photos: list[Path], analysis: dict) -> Path:
    """Pick the photo with the most useful camera angle from a list."""
    for p in photos:
        sp = analysis.get(p.name, {}).get("spatial", {})
        cam = sp.get("camera_position", "").lower()
        if any(w in cam for w in ["toward", "facing", "northeast", "northwest", "southeast", "southwest"]):
            return p
    return photos[0]


def stage_zone(
    zone: str,
    photo_paths: list[Path],
    manifest: str,
    analysis: dict,
) -> list[Path]:
    client = genai.Client(api_key=GEMINI_API_KEY)
    (OUTPUTS_DIR / zone).mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    zone_config = ZONES[zone]
    room_types = zone_config.get("room_types", [])

    # Group photos by room_type within this zone
    sub_area_photos: dict[str, list[Path]] = {rt: [] for rt in room_types}
    for p in photo_paths:
        rt = analysis.get(p.name, {}).get("room_type", "")
        if rt in sub_area_photos:
            sub_area_photos[rt].append(p)

    # Select one hero per sub-area.
    # For bathroom_suite the bathroom hero must have room_type == "bathroom"
    # so the closet logic always has a valid staged bathroom reference.
    heroes: dict[str, Path] = {}
    for rt, photos in sub_area_photos.items():
        if not photos:
            continue
        if zone == "bathroom_suite" and rt == "bathroom_closet":
            # Closet is never the hero; it will be staged with bathroom as context
            continue
        heroes[rt] = _select_hero(photos, analysis)

    staged: list[Path] = []
    staged_heroes: dict[str, Path] = {}  # room_type → staged hero output path

    # Stage all heroes first
    for rt, hero in heroes.items():
        hero_out = _out_path(hero, zone)
        if not hero_out.exists():
            print(f"    [hero]  {hero.name}...")
            sp = analysis.get(hero.name, {}).get("spatial", {})
            prompt = HERO_PROMPT.format(manifest=manifest, **_fmt_spatial(sp))
            with open(hero, "rb") as f:
                img_data = f.read()
            result = _generate(client, [prompt, types.Part.from_bytes(data=img_data, mime_type="image/jpeg")])
            if result:
                _save(result, hero_out)
                print(f"    [hero]  saved → {hero_out.relative_to(hero_out.parent.parent.parent)}")
            else:
                print(f"    WARNING: hero generation failed for {hero.name}")
                continue
        else:
            print(f"    [hero]  {hero.name} (cached)")
        staged.append(hero_out)
        staged_heroes[rt] = hero_out

    if not staged_heroes:
        return staged

    # All non-hero photos
    hero_set = set(heroes.values())
    rest = [p for p in photo_paths if p not in hero_set]

    if not rest:
        return staged

    # Build merged catalog from all staged heroes
    print(f"    Building catalog from hero...")
    all_hero_outs = list(staged_heroes.values())
    catalog_path, counts = _build_catalog(all_hero_outs, zone)

    # Separate closet photos (bathroom_suite only)
    closet_photos = []
    regular_rest = []
    if zone == "bathroom_suite":
        for p in rest:
            rt = analysis.get(p.name, {}).get("room_type", "")
            if rt == "bathroom_closet":
                closet_photos.append(p)
            else:
                regular_rest.append(p)
    else:
        regular_rest = rest

    # Stage regular photos with [empty_room, sub-area staged hero, catalog]
    for photo in regular_rest:
        out = _out_path(photo, zone)
        if out.exists():
            print(f"    [ref]   {photo.name} (cached)")
            staged.append(out)
            continue
        print(f"    [ref]   {photo.name}...")
        sp = analysis.get(photo.name, {}).get("spatial", {})
        prompt = CATALOG_PROMPT.format(count_manifest=_fmt_counts(counts), **_fmt_spatial(sp))

        photo_rt = analysis.get(photo.name, {}).get("room_type", "")
        hero_ref_out = staged_heroes.get(photo_rt) or all_hero_outs[0]

        with open(photo, "rb") as f:
            empty_data = f.read()
        with open(hero_ref_out, "rb") as f:
            hero_ref_data = f.read()

        if catalog_path and catalog_path.exists():
            with open(catalog_path, "rb") as f:
                cat_data = f.read()
            contents = [
                prompt,
                types.Part.from_bytes(data=empty_data, mime_type="image/jpeg"),   # IMAGE 1: canvas
                types.Part.from_bytes(data=hero_ref_data, mime_type="image/jpeg"), # IMAGE 2: identity reference
                types.Part.from_bytes(data=cat_data, mime_type="image/jpeg"),       # IMAGE 3: catalog
            ]
        else:
            contents = [
                HERO_PROMPT.format(manifest=manifest, **_fmt_spatial(sp)),
                types.Part.from_bytes(data=empty_data, mime_type="image/jpeg"),
            ]

        result = _generate(client, contents)
        if result:
            _save(result, out)
            print(f"    [ref]   saved → {out.relative_to(out.parent.parent.parent)}")
            staged.append(out)

    # Closet photos with staged bathroom context
    bathroom_out = staged_heroes.get("bathroom") or all_hero_outs[0]
    for photo in closet_photos:
        out = _out_path(photo, zone)
        if out.exists():
            print(f"    [closet] {photo.name} (cached)")
            staged.append(out)
            continue
        print(f"    [closet] {photo.name}...")
        sp = analysis.get(photo.name, {}).get("spatial", {})
        prompt = CLOSET_PROMPT.format(**_fmt_spatial(sp))
        with open(photo, "rb") as f:
            empty_data = f.read()
        with open(bathroom_out, "rb") as f:
            bathroom_data = f.read()
        result = _generate(client, [
            prompt,
            types.Part.from_bytes(data=empty_data, mime_type="image/jpeg"),
            types.Part.from_bytes(data=bathroom_data, mime_type="image/jpeg"),
        ])
        if result:
            _save(result, out)
            print(f"    [closet] saved → {out.relative_to(out.parent.parent.parent)}")
            staged.append(out)

    return staged
