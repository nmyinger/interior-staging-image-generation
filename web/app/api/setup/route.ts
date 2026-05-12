/**
 * GET /api/setup
 * Runs migrations and seeds photos from ../Source Photos/ into the DB.
 * Idempotent — safe to call multiple times. Skip photos already in DB.
 */
import { NextResponse } from "next/server";
import { sql, migrate } from "@/lib/db";
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
  await migrate();

  let analysis: Record<string, { room_type: string }> = {};
  let photoManifests: Record<string, string> = {};
  try {
    analysis = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, "analysis.json"), "utf-8"));
  } catch {}
  try {
    photoManifests = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, "photo_manifests.json"), "utf-8"));
  } catch {}

  const files = fs
    .readdirSync(PHOTOS_DIR)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f) && !SKIP.has(f))
    .sort();

  let seeded = 0;
  for (const filename of files) {
    const existing = await sql`SELECT filename FROM photos WHERE filename = ${filename}`;
    if (existing.length > 0) continue;

    const filePath = path.join(PHOTOS_DIR, filename);
    const bytes = fs.readFileSync(filePath);
    const b64 = bytes.toString("base64");
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const roomType = analysis[filename]?.room_type ?? "unknown";
    const zone = ROOM_TO_ZONE[roomType] ?? "unknown";
    const defaultPrompt = photoManifests[filename] ?? "";

    await sql`
      INSERT INTO photos (filename, room_type, zone, default_prompt, image_b64, mime_type)
      VALUES (${filename}, ${roomType}, ${zone}, ${defaultPrompt}, ${b64}, ${mime})
      ON CONFLICT (filename) DO NOTHING
    `;
    seeded++;
  }

  return NextResponse.json({ ok: true, migrationsRun: true, photosSeeded: seeded });
}
