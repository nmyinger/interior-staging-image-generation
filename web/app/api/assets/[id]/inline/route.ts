import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// GET /api/assets/[id]/inline
// Dev fallback: serves base64-stored asset when Blob is not configured.
// Not used in production (all assets have real blob_url values).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await sql`
    SELECT mime_type, data_b64 FROM asset_inline_data WHERE asset_id = ${id}
  `;
  if (!rows.length) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { mime_type, data_b64 } = rows[0] as { mime_type: string; data_b64: string };
  return new NextResponse(Buffer.from(data_b64, "base64"), {
    status: 200,
    headers: {
      "content-type": mime_type,
      "cache-control": "private, max-age=60",
    },
  });
}
