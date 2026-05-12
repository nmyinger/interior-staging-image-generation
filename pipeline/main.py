"""
Virtual Staging Pipeline — v6
Usage:
  python3 main.py                    # stage all photos; skip existing outputs
  python3 main.py --force            # regenerate everything from scratch
  python3 main.py --zone open_plan   # stage only a specific zone

Cost profile:
  Text calls (cheap): 1 batch analysis + 1 zone manifest + N per-photo manifests ≈ $0.01
  Image calls ($0.039 each): 1 per photo staged
  Caching: all results cached; re-runs only pay for new image generation
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import SOURCE_DIR, OUTPUTS_DIR, CACHE_DIR, ZONES
from analyze import run_analysis, group_by_zone
from manifest import generate_manifest, generate_photo_manifests
from stage import stage_zone


def main():
    force = "--force" in sys.argv
    zone_filter = next((a.split("=")[1] for a in sys.argv if a.startswith("--zone=")), None)
    if zone_filter is None:
        for i, a in enumerate(sys.argv):
            if a == "--zone" and i + 1 < len(sys.argv):
                zone_filter = sys.argv[i + 1]

    print("Virtual Staging Pipeline v6")
    print("=" * 50)
    if force:
        print("  --force: regenerating all cached results")
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Batch analysis (classify + spatial, 1 API call, cached)
    print("\n[1/4] Analyzing photos (classify + spatial)...")
    analysis = run_analysis(force=force)
    zones = group_by_zone(analysis)

    for filename, data in sorted(analysis.items()):
        zone = next(
            (z for z, paths in zones.items() if SOURCE_DIR / filename in paths), "skip"
        )
        print(f"  {filename:30s} → {data['room_type']:20s} (zone: {zone})")

    # Step 2: Zone manifests (1 API call, cached)
    print("\n[2/4] Generating zone manifests...")
    zone_manifests = generate_manifest(force=force)

    # Step 3: Per-photo manifests (1 cheap text call per photo, cached)
    print("\n[3/4] Generating per-photo manifests...")
    photo_manifests = generate_photo_manifests(analysis, zone_manifests, force=force)

    # Step 4: Stage per zone (image generation, outputs cached per file)
    print("\n[4/4] Staging zones...")
    total = 0
    for zone, paths in zones.items():
        if zone_filter and zone != zone_filter:
            continue
        display = ZONES[zone]["display"]
        print(f"\n  Zone: {display} ({len(paths)} photo(s))")
        manifest_text = zone_manifests.get(zone, zone_manifests.get("full", ""))
        staged = stage_zone(zone, paths, manifest_text, analysis, photo_manifests)
        total += len(staged)
        print(f"  → {len(staged)} staged")

    print(f"\n{'='*50}")
    print(f"Done. {total} photos staged.")
    for zone, paths in zones.items():
        if not zone_filter or zone == zone_filter:
            print(f"  {zone}: {len(paths)} image(s) → outputs/{zone}/")


if __name__ == "__main__":
    main()
