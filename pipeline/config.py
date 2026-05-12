import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
MODEL = "gemini-3.1-flash-image-preview"

SOURCE_DIR = Path(__file__).parent.parent / "Source Photos"
OUTPUTS_DIR = Path(__file__).parent.parent / "outputs"

SKIP_ROOMS = {"skip"}

ROOM_DISPLAY = {
    "kitchen": "Kitchen",
    "living_room": "Living Room",
    "bedroom": "Bedroom",
    "bathroom": "Bathroom",
    "bathroom_closet": "Bathroom & Closet",
}
