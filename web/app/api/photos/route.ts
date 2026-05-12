import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PHOTOS_DIR = path.resolve(process.cwd(), "../Source Photos");
const CACHE_DIR = path.resolve(process.cwd(), "../.cache");

const SKIP = new Set(["FLN_9405_1.jpg", "FLN_9411_1.jpg"]);

const ROOM_TO_ZONE: Record<string, string> = {
  kitchen: "open_plan",
  living_room: "open_plan",
  bedroom: "bedroom",
  bathroom: "bathroom_suite",
  bathroom_closet: "bathroom_suite",
};

export async function GET() {
  const files = fs
    .readdirSync(PHOTOS_DIR)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f) && !SKIP.has(f))
    .sort();

  // Load analysis cache for room types and prompts
  let analysis: Record<string, { room_type: string; spatial: Record<string, unknown> }> = {};
  let photoManifests: Record<string, string> = {};
  try {
    analysis = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, "analysis.json"), "utf-8"));
  } catch {}
  try {
    photoManifests = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, "photo_manifests.json"), "utf-8"));
  } catch {}

  const photos = files.map((filename) => {
    const data = analysis[filename] ?? {};
    const roomType = data.room_type ?? "unknown";
    const zone = ROOM_TO_ZONE[roomType] ?? "unknown";
    return {
      filename,
      roomType,
      zone,
      prompt: photoManifests[filename] ?? "",
    };
  });

  return NextResponse.json({ photos });
}
