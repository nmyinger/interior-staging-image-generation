/**
 * GET /api/setup
 * Runs migrations and seeds photos from ../Source Photos/ into the DB.
 * Idempotent — safe to call multiple times. Skips photos already in DB.
 * Requires SETUP_SECRET header if SETUP_SECRET env var is set.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql, migrate } from "@/lib/db";
import { uploadToBlob, isBlobConfigured } from "@/lib/storage";
import { readFile, readdir } from "fs/promises";
import path from "path";

const PHOTOS_DIR = path.resolve(process.cwd(), "../Source Photos");
const CACHE_DIR = path.resolve(process.cwd(), "../.cache");
const SKIP = new Set(["FLN_9405_1.jpg", "FLN_9411_1.jpg"]);
const SETUP_USER_ID = "setup"; // sentinel for pipeline-seeded photos

const ROOM_TO_ZONE: Record<string, string> = {
  kitchen: "open_plan",
  living_room: "open_plan",
  bedroom: "bedroom",
  bathroom: "bathroom_suite",
  bathroom_closet: "bathroom_suite",
};

export async function GET(req: NextRequest) {
  const secret = process.env.SETUP_SECRET;
  if (secret && req.headers.get("x-setup-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await migrate();

  const [analysisRaw, manifestsRaw] = await Promise.all([
    readFile(path.join(CACHE_DIR, "analysis.json"), "utf-8").catch(() => "{}"),
    readFile(path.join(CACHE_DIR, "photo_manifests.json"), "utf-8").catch(() => "{}"),
  ]);
  const analysis: Record<string, { room_type: string }> = JSON.parse(analysisRaw);
  const photoManifests: Record<string, string> = JSON.parse(manifestsRaw);

  const allFiles = (await readdir(PHOTOS_DIR))
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f) && !SKIP.has(f))
    .sort();

  const existingRows = allFiles.length > 0
    ? await sql`SELECT filename FROM photos WHERE filename = ANY(${allFiles})`
    : [];
  const existingSet = new Set(existingRows.map((r) => r.filename as string));
  const newFiles = allFiles.filter((f) => !existingSet.has(f));

  const photoBuffers = await Promise.all(
    newFiles.map((filename) =>
      readFile(path.join(PHOTOS_DIR, filename)).then((bytes) => ({ filename, bytes }))
    )
  );

  let photosSeeded = 0;
  await Promise.all(
    photoBuffers.map(async ({ filename, bytes }) => {
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      const roomType = analysis[filename]?.room_type ?? "unknown";
      const zone = ROOM_TO_ZONE[roomType] ?? "unknown";
      const defaultPrompt = photoManifests[filename] ?? "";

      if (isBlobConfigured()) {
        const imageUrl = await uploadToBlob(`photos/${SETUP_USER_ID}/${filename}`, bytes, mime);
        await sql`
          INSERT INTO photos (filename, user_id, room_type, zone, default_prompt, image_url, mime_type)
          VALUES (${filename}, ${SETUP_USER_ID}, ${roomType}, ${zone}, ${defaultPrompt}, ${imageUrl}, ${mime})
          ON CONFLICT (filename) DO NOTHING
        `;
      } else {
        const b64 = bytes.toString("base64");
        await sql`
          INSERT INTO photos (filename, user_id, room_type, zone, default_prompt, image_b64, mime_type)
          VALUES (${filename}, ${SETUP_USER_ID}, ${roomType}, ${zone}, ${defaultPrompt}, ${b64}, ${mime})
          ON CONFLICT (filename) DO NOTHING
        `;
      }
      photosSeeded++;
    })
  );

  return NextResponse.json({ ok: true, migrationsRun: true, photosSeeded });
}
