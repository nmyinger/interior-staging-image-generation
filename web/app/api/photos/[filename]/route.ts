import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import sharp from "sharp";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const rows = await sql`
    SELECT image_b64, mime_type FROM photos WHERE filename = ${filename}
  `;
  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { image_b64, mime_type } = rows[0];
  let buffer = Buffer.from(image_b64 as string, "base64");

  const w = req.nextUrl.searchParams.get("w");
  if (w) {
    const width = Math.min(parseInt(w, 10), 1200);
    if (width > 0) {
      buffer = Buffer.from(await sharp(buffer).resize({ width, withoutEnlargement: true }).toBuffer());
    }
  }

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime_type as string,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
