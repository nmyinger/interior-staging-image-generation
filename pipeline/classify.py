"""
Step 1: Classify each source photo into a room type using Gemini vision.
Returns {filename: room_type} dict.
"""
import json
from pathlib import Path
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, SOURCE_DIR

ROOM_TYPES = ["kitchen", "living_room", "bedroom", "bathroom", "bathroom_closet", "skip"]

CLASSIFY_PROMPT = """You are classifying real estate photos by room type.

Look at each of these apartment photos and assign exactly one room type to each.

Room types:
- kitchen: kitchen area, even if open to living space
- living_room: main living/dining area with hardwood or LVP floors
- bedroom: bedroom with carpet or hard floors
- bathroom: bathroom (toilet, shower/tub, vanity)
- bathroom_closet: hallway view showing both a bathroom entrance and a closet
- skip: parking garage, building lobby, amenity spaces, or already-furnished spaces

Respond with ONLY valid JSON in this exact format:
{
  "filename1.jpg": "room_type",
  "filename2.JPG": "room_type"
}

No explanation, no markdown fences, just the JSON object."""


def classify_photos() -> dict[str, str]:
    client = genai.Client(api_key=GEMINI_API_KEY)

    photos = sorted(SOURCE_DIR.iterdir())
    parts = [CLASSIFY_PROMPT]

    for photo in photos:
        with open(photo, "rb") as f:
            data = f.read()
        ext = photo.suffix.lower()
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
        parts.append(types.Part.from_bytes(data=data, mime_type=mime))
        parts.append(f"Filename: {photo.name}")

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=parts,
    )

    raw = response.text.strip()
    # strip markdown fences if model ignores instructions
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    classification = json.loads(raw)
    return classification


if __name__ == "__main__":
    result = classify_photos()
    for filename, room in sorted(result.items()):
        print(f"  {filename:30s} → {room}")
