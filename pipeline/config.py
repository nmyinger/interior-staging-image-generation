import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]

# Text-only reasoning model (cheap)
MODEL_TEXT = "gemini-2.5-flash"
# Image generation model
MODEL_IMAGE = "gemini-3.1-flash-image-preview"

SOURCE_DIR = Path(__file__).parent.parent / "Source Photos"
OUTPUTS_DIR = Path(__file__).parent.parent / "outputs"
CACHE_DIR = Path(__file__).parent.parent / ".cache"

# Photos to skip entirely — not stageable spaces
SKIP_PHOTOS = {"FLN_9405_1.jpg", "FLN_9411_1.jpg"}  # garage, lobby

# Zone grouping — reflects physical connectivity of the apartment.
# Photos in the same zone share overlapping physical space and must have
# a consistent furniture style. The pipeline stages them as one unit.
ZONES = {
    "open_plan": {
        "display": "Open Plan (Kitchen + Living Room)",
        "room_types": ["kitchen", "living_room"],
        # hero selection: prefer the photo that shows both spaces widest
    },
    "bedroom": {
        "display": "Bedroom",
        "room_types": ["bedroom"],
    },
    "bathroom_suite": {
        "display": "Bathroom Suite",
        "room_types": ["bathroom", "bathroom_closet"],
        # bathroom_closet looks into bathroom — staged bathroom
        # is passed as context so accessories match through the doorway
    },
}

# Flat lookup: room_type → zone name
ROOM_TO_ZONE = {
    room: zone
    for zone, cfg in ZONES.items()
    for room in cfg["room_types"]
}
