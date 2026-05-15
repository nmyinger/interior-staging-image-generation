import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { uploadToBlob, isBlobConfigured } from "@/lib/storage";
import { z } from "zod";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB base64-encoded

function getUserId(session: unknown): string | undefined {
  return (session as { user?: { id?: string } } | null)?.user?.id;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = getUserId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await sql`
    SELECT filename, room_type, zone, default_prompt
    FROM photos
    WHERE user_id = ${uid} OR user_id = ''
    ORDER BY zone, filename
  `;
  return NextResponse.json({ photos: rows });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getUserId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  // blobUrl: already uploaded client-side (preferred path)
  // b64: legacy fallback for dev environments without Blob configured
  const photoUploadSchema = z.object({
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    blobUrl: z.string().optional(),
    b64: z.string().optional(),
  });

  const parsed = photoUploadSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { filename, mimeType, blobUrl, b64 } = parsed.data;

  if (!blobUrl && !b64) {
    return NextResponse.json({ error: "Either blobUrl or b64 is required" }, { status: 400 });
  }

  if (b64 && b64.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  // Idempotent: return existing photo if this user already uploaded this filename
  const existing = await sql`
    SELECT filename, room_type, zone, default_prompt
    FROM photos WHERE filename = ${filename} AND user_id = ${uid}
  `;
  if (existing.length > 0) {
    return NextResponse.json({ ok: true, photo: existing[0] });
  }

  if (blobUrl) {
    // Client already uploaded directly to Blob — just register the URL
    await sql`
      INSERT INTO photos (filename, user_id, room_type, zone, default_prompt, image_url, mime_type)
      VALUES (${filename}, ${uid}, 'unknown', 'unknown', '', ${blobUrl}, ${mimeType})
      ON CONFLICT (filename) DO UPDATE
        SET user_id = EXCLUDED.user_id, image_url = EXCLUDED.image_url
    `;
  } else if (b64) {
    if (isBlobConfigured()) {
      const imageUrl = await uploadToBlob(`photos/${uid}/${filename}`, b64, mimeType);
      await sql`
        INSERT INTO photos (filename, user_id, room_type, zone, default_prompt, image_url, mime_type)
        VALUES (${filename}, ${uid}, 'unknown', 'unknown', '', ${imageUrl}, ${mimeType})
        ON CONFLICT (filename) DO UPDATE
          SET user_id = EXCLUDED.user_id, image_url = EXCLUDED.image_url
      `;
    } else {
      await sql`
        INSERT INTO photos (filename, user_id, room_type, zone, default_prompt, image_b64, mime_type)
        VALUES (${filename}, ${uid}, 'unknown', 'unknown', '', ${b64}, ${mimeType})
        ON CONFLICT (filename) DO UPDATE
          SET user_id = EXCLUDED.user_id, image_b64 = EXCLUDED.image_b64
      `;
    }
  }

  return NextResponse.json({ ok: true, photo: { filename, room_type: "unknown", zone: "unknown", default_prompt: "" } });
}
