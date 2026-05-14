import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { uploadToBlob, isBlobConfigured } from "@/lib/storage";

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

  const { filename, mimeType, b64 } = await req.json() as {
    filename: string;
    mimeType: string;
    b64: string;
  };

  if (!filename || !mimeType || !b64) {
    return NextResponse.json({ error: "filename, mimeType, and b64 are required" }, { status: 400 });
  }

  if (b64.length > MAX_UPLOAD_BYTES) {
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
      ON CONFLICT (filename) DO NOTHING
    `;
  }

  return NextResponse.json({ ok: true, photo: { filename, room_type: "unknown", zone: "unknown", default_prompt: "" } });
}
