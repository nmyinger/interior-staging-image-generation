"""
Virtual Staging Pipeline — v5
Usage:
  python3 main.py           # uses cached analysis/manifest; skips existing outputs
  python3 main.py --force   # regenerates everything from scratch

Cost profile:
  Text calls  (cheap): 1 batch analysis + 1 manifest = 2 Gemini text calls total
  Image calls ($0.039 each): 1 hero per sub-area per zone + N remaining photos
  Caching: all text results and staged images are cached; re-runs only pay
           for genuinely new image generation calls
"""
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import SOURCE_DIR, OUTPUTS_DIR, CACHE_DIR, ZONES
from analyze import run_analysis, group_by_zone
from manifest import generate_manifest
from stage import stage_zone


def main():
    force = "--force" in sys.argv

    print("Virtual Staging Pipeline v5")
    print("=" * 50)
    if force:
        print("  --force: regenerating all cached results")
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Batch analysis (classify + spatial, 1 API call, cached)
    print("\n[1/3] Analyzing photos (classify + spatial)...")
    analysis = run_analysis(force=force)
    zones = group_by_zone(analysis)

    for filename, data in sorted(analysis.items()):
        zone = next(
            (z for z, paths in zones.items() if SOURCE_DIR / filename in paths), "skip"
        )
        print(f"  {filename:30s} → {data['room_type']:20s} (zone: {zone})")

    # Step 2: Apartment manifest (1 API call, cached)
    print("\n[2/3] Generating apartment manifest...")
    manifests = generate_manifest(force=force)

    # Step 3: Stage per zone (image generation, outputs cached per file)
    print("\n[3/3] Staging zones...")
    total = 0
    for zone, paths in zones.items():
        display = ZONES[zone]["display"]
        print(f"\n  Zone: {display} ({len(paths)} photo(s))")
        manifest_text = manifests.get(zone, manifests.get("full", ""))
        staged = stage_zone(zone, paths, manifest_text, analysis)
        total += len(staged)
        print(f"  → {len(staged)} staged")

    print(f"\n{'='*50}")
    print(f"Done. {total} photos staged across {len(zones)} zones.")
    for zone, paths in zones.items():
        print(f"  {zone}: {len(paths)} image(s) → outputs/{zone}/")


if __name__ == "__main__":
    main()
