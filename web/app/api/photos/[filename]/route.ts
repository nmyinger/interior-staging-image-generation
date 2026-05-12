import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(
  _req: NextRequest,
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
  const buffer = Buffer.from(image_b64 as string, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime_type as string,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
