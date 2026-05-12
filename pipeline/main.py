"""
Virtual Staging Pipeline — Slice 1 (v3)
Usage: python3 main.py

Steps:
  1. Classify    — group photos by room
  2. Spatial     — per-photo geometry analysis (camera, walls, clearances, zones)
  3. Manifest    — per-room furniture identity spec (colors, materials, dims)
  4. Hero        — stage the best-angle photo per room (manifest + spatial)
  5. Catalog     — extract per-object tiles from hero into a labeled grid image
  6. Stage rest  — stage remaining angles using [empty_room, catalog_grid]
                   with spatial plan + count locks; no full-scene reference
"""
import sys
import json
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))

from config import SOURCE_DIR, OUTPUTS_DIR, SKIP_ROOMS
from classify import classify_photos
from spatial_analysis import analyze_all_photos
from manifest import generate_all_manifests
from catalog import extract_catalog
from stage import select_hero, stage_hero, stage_with_catalog, stage_room, stage_all_rooms


def group_by_room(classification: dict[str, str]) -> dict[str, list[Path]]:
    groups: dict[str, list[Path]] = defaultdict(list)
    for filename, room in classification.items():
        if room not in SKIP_ROOMS:
            groups[room].append(SOURCE_DIR / filename)
    return {room: sorted(paths) for room, paths in groups.items()}


def main():
    print("Virtual Staging Pipeline v3")
    print("=" * 50)

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Classify
    print("\n[1/5] Classifying photos...")
    classification = classify_photos()
    for filename, room in sorted(classification.items()):
        print(f"  {filename:30s} → {room}")

    groups = group_by_room(classification)
    print(f"\n  Rooms to stage: {list(groups.keys())}")
    (OUTPUTS_DIR / "classification.json").write_text(json.dumps(classification, indent=2))

    # Step 2: Spatial analysis
    print("\n[2/5] Analyzing room geometry per photo...")
    spatial_analyses = analyze_all_photos(groups)

    # Step 3: Manifests
    print("\n[3/5] Generating furniture manifests...")
    manifests = generate_all_manifests(groups)

    # Step 4 + 5: Hero staging + catalog extraction per room
    print("\n[4/5] Staging hero shots and extracting catalogs...")
    catalogs: dict[str, tuple[Path | None, dict]] = {}

    for room, paths in groups.items():
        room_display = room.replace("_", " ").title()
        hero_path = select_hero(paths, spatial_analyses)
        print(f"  {room_display}: hero = {hero_path.name}")

        spatial = spatial_analyses.get(hero_path.name, {})
        hero_staged = stage_hero(hero_path, room, manifests[room], spatial)

        if hero_staged:
            print(f"  Extracting catalog from hero...")
            catalog_path, count_manifest = extract_catalog(hero_staged, room)
            catalogs[room] = (catalog_path, count_manifest)
            print(f"  Count manifest: {count_manifest}")
        else:
            catalogs[room] = (None, {})

    # Step 6: Stage remaining photos
    print("\n[5/5] Staging remaining photos with catalog reference...")
    all_results: dict[str, list[Path]] = {}

    for room, paths in groups.items():
        room_display = room.replace("_", " ").title()
        hero_path = select_hero(paths, spatial_analyses)
        remaining = [p for p in paths if p != hero_path]

        # collect all staged paths (hero already done above)
        hero_out = OUTPUTS_DIR / room / f"{hero_path.stem}_staged.jpg"
        staged = [hero_out] if hero_out.exists() else []

        if remaining:
            print(f"  {room_display}: {len(remaining)} remaining photo(s)...")
            catalog_path, count_manifest = catalogs.get(room, (None, {}))
            for photo_path in remaining:
                spatial = spatial_analyses.get(photo_path.name, {})
                if not spatial:
                    continue
                print(f"    Staging {photo_path.name}...")
                if catalog_path and catalog_path.exists():
                    result = stage_with_catalog(
                        photo_path, room, spatial, catalog_path, count_manifest
                    )
                else:
                    result = stage_hero(photo_path, room, manifests[room], spatial)
                if result:
                    staged.append(result)

        all_results[room] = staged

    # Summary
    total = sum(len(paths) for paths in all_results.values())
    print(f"\n{'='*50}")
    print(f"Done. {total} photos staged.")
    for room, paths in all_results.items():
        print(f"  {room}: {len(paths)} image(s) → outputs/{room}/")


if __name__ == "__main__":
    main()
