"""
Virtual Staging Pipeline — Slice 1
Usage: python main.py
"""
import sys
import json
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))

from config import SOURCE_DIR, OUTPUTS_DIR, SKIP_ROOMS
from classify import classify_photos
from manifest import generate_all_manifests
from stage import stage_all_rooms


def group_by_room(classification: dict[str, str]) -> dict[str, list[Path]]:
    groups: dict[str, list[Path]] = defaultdict(list)
    for filename, room in classification.items():
        if room not in SKIP_ROOMS:
            groups[room].append(SOURCE_DIR / filename)
    # sort each group so angles are processed in consistent filename order
    return {room: sorted(paths) for room, paths in groups.items()}


def main():
    print("Virtual Staging Pipeline")
    print("=" * 50)

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Classify
    print("\n[1/3] Classifying photos...")
    classification = classify_photos()
    for filename, room in sorted(classification.items()):
        print(f"  {filename:30s} → {room}")

    groups = group_by_room(classification)
    print(f"\n  Rooms to stage: {list(groups.keys())}")

    # Save classification for inspection
    (OUTPUTS_DIR / "classification.json").write_text(
        json.dumps(classification, indent=2)
    )

    # Step 2: Manifests
    print("\n[2/3] Generating furniture manifests...")
    manifests = generate_all_manifests(groups)

    # Step 3: Stage
    print("\n[3/3] Staging photos...")
    results = stage_all_rooms(groups, manifests)

    # Summary
    total = sum(len(paths) for paths in results.values())
    print(f"\n{'='*50}")
    print(f"Done. {total} photos staged.")
    for room, paths in results.items():
        print(f"  {room}: {len(paths)} image(s) → outputs/{room}/")


if __name__ == "__main__":
    main()
