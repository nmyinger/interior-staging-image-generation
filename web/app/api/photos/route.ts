import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const rows = await sql`
    SELECT filename, room_type, zone, default_prompt
    FROM photos
    ORDER BY zone, filename
  `;
  return NextResponse.json({ photos: rows });
}

export async function POST(req: NextRequest) {
  const { filename, mimeType, b64 } = await req.json() as {
    filename: string;
    mimeType: string;
    b64: string;
  };

  if (!filename || !mimeType || !b64) {
    return NextResponse.json({ error: "filename, mimeType, and b64 are required" }, { status: 400 });
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
