"""
Step 4b: Catalog extraction from the hero staged image.

Takes the hero staged image, uses Gemini vision to identify each furniture
piece's bounding box, crops them, and composes a labeled catalog grid on a
neutral background. This catalog is passed (not the full hero scene) as the
visual reference for staging subsequent angles — breaking the model's
scene-copying instinct.

Also produces a count manifest (e.g. {"sofa": 1, "accent_chair": 2}) used
to lock accessory counts in generation prompts.
"""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, OUTPUTS_DIR

BBOX_PROMPT = """Identify every distinct furniture piece in this virtual staging image.

For each piece output a bounding box and a short label (e.g. "sofa", "accent_chair", "coffee_table", "tv_console", "arc_lamp", "bar_stool", "dining_chair", "dining_table", "side_table", "dresser", "bed", "nightstand").

Rules:
- Include ONLY furniture and decor objects (rugs, pillows, lamps, plants are ok)
- Exclude walls, floors, ceiling, windows, appliances that are part of the architecture
- If the same piece appears partially cut off at frame edge, still include it
- Use singular labels even for multiple identical pieces (label each instance separately)

Output ONLY valid JSON, no explanation:
{
  "pieces": [
    {"label": "sofa", "x1": 120, "y1": 450, "x2": 880, "y2": 920},
    {"label": "accent_chair", "x1": 20, "y1": 490, "x2": 180, "y2": 780}
  ],
  "counts": {
    "sofa": 1,
    "accent_chair": 1,
    "coffee_table": 1
  }
}

Coordinates are integers on a 0–1000 scale where (0,0) is top-left and (1000,1000) is bottom-right."""

TILE_SIZE = 320
TILE_PADDING = 16
LABEL_HEIGHT = 36
GRID_BG = (245, 245, 242)
TILE_BG = (255, 255, 255)
LABEL_COLOR = (60, 60, 60)
GRID_COLS = 3


def _crop_piece(img: Image.Image, piece: dict, margin: int = 24) -> Image.Image:
    W, H = img.size
    x1 = max(0, int(piece["x1"] / 1000 * W) - margin)
    y1 = max(0, int(piece["y1"] / 1000 * H) - margin)
    x2 = min(W, int(piece["x2"] / 1000 * W) + margin)
    y2 = min(H, int(piece["y2"] / 1000 * H) + margin)
    return img.crop((x1, y1, x2, y2))


def _make_tile(crop: Image.Image, label: str) -> Image.Image:
    """Fit crop into TILE_SIZE square on white bg, add label bar below."""
    inner = TILE_SIZE - TILE_PADDING * 2
    crop.thumbnail((inner, inner), Image.LANCZOS)
    tile = Image.new("RGB", (TILE_SIZE, TILE_SIZE + LABEL_HEIGHT), TILE_BG)
    # center crop
    x = (TILE_SIZE - crop.width) // 2
    y = TILE_PADDING + (inner - crop.height) // 2
    tile.paste(crop, (x, y))
    # label bar
    draw = ImageDraw.Draw(tile)
    draw.rectangle([(0, TILE_SIZE), (TILE_SIZE, TILE_SIZE + LABEL_HEIGHT)], fill=(230, 230, 228))
    display = label.replace("_", " ").upper()
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 13)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), display, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        ((TILE_SIZE - tw) // 2, TILE_SIZE + (LABEL_HEIGHT - th) // 2),
        display,
        fill=LABEL_COLOR,
        font=font,
    )
    return tile


def _build_grid(tiles: list[Image.Image]) -> Image.Image:
    cols = min(GRID_COLS, len(tiles))
    rows = math.ceil(len(tiles) / cols)
    tile_w = TILE_SIZE
    tile_h = TILE_SIZE + LABEL_HEIGHT
    gap = 12
    grid_w = cols * tile_w + (cols - 1) * gap + gap * 2
    grid_h = rows * tile_h + (rows - 1) * gap + gap * 2
    grid = Image.new("RGB", (grid_w, grid_h), GRID_BG)
    for i, tile in enumerate(tiles):
        row, col = divmod(i, cols)
        x = gap + col * (tile_w + gap)
        y = gap + row * (tile_h + gap)
        grid.paste(tile, (x, y))
    return grid


def extract_catalog(hero_path: Path, room: str) -> tuple[Path, dict]:
    """
    Extract per-object catalog grid and count manifest from a hero staged image.

    Returns:
        catalog_path: Path to the saved catalog grid image
        count_manifest: {piece_label: count} dict
    """
    client = genai.Client(api_key=GEMINI_API_KEY)

    with open(hero_path, "rb") as f:
        hero_data = f.read()

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            BBOX_PROMPT,
            types.Part.from_bytes(data=hero_data, mime_type="image/jpeg"),
        ],
    )

    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    data = json.loads(raw)
    pieces = data.get("pieces", [])
    count_manifest = data.get("counts", {})

    out_dir = OUTPUTS_DIR / room
    out_dir.mkdir(parents=True, exist_ok=True)

    # save raw bbox data for inspection
    (out_dir / "catalog_bboxes.json").write_text(json.dumps(data, indent=2))

    if not pieces:
        print(f"    WARNING: No furniture pieces detected in hero image {hero_path.name}")
        return None, count_manifest

    hero_img = Image.open(hero_path)
    tiles = []
    for piece in pieces:
        crop = _crop_piece(hero_img, piece)
        if crop.width < 20 or crop.height < 20:
            continue
        tile = _make_tile(crop, piece["label"])
        tiles.append(tile)

    if not tiles:
        return None, count_manifest

    grid = _build_grid(tiles)
    catalog_path = out_dir / "catalog_grid.jpg"
    grid.save(catalog_path, "JPEG", quality=95)
    print(f"    Catalog: {len(tiles)} pieces → {catalog_path.relative_to(catalog_path.parent.parent.parent)}")

    return catalog_path, count_manifest
