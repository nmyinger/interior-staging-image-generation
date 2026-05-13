import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB base64-encoded

export async function GET() {
  const rows = await sql`
    SELECT filename, room_type, zone, default_prompt
    FROM photos
    ORDER BY zone, filename
  `;
  return NextResponse.json({ photos: rows });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as { id?: string } | undefined)?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const existing = await sql`SELECT filename, room_type, zone, default_prompt FROM photos WHERE filename = ${filename}`;
  if (existing.length > 0) {
    return NextResponse.json({ ok: true, photo: existing[0] });
  }

  await sql`
    INSERT INTO photos (filename, room_type, zone, default_prompt, image_b64, mime_type)
    VALUES (${filename}, 'unknown', 'unknown', '', ${b64}, ${mimeType})
    ON CONFLICT (filename) DO NOTHING
  `;

  return NextResponse.json({ ok: true, photo: { filename, room_type: "unknown", zone: "unknown", default_prompt: "" } });
}
