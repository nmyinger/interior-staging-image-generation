import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

// GET /api/batches/[id] — batch status + all batch_items
// Requires auth; any authenticated user can poll a batch they triggered
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id: batchId } = await params;

    // Fetch batch — join through to verify this user's org owns it
    const batchRows = await sql`
      SELECT b.id, b.status, b.manifest, b.model, b.started_at, b.finished_at, b.error,
             b.property_id, b.org_id
      FROM batches b
      JOIN properties p ON p.id = b.property_id
      JOIN users u ON u.default_org_id = p.org_id
      WHERE b.id = ${batchId} AND u.id = ${uid}
    `;

    if (!batchRows[0]) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const batch = batchRows[0];

    const items = await sql`
      SELECT
        bi.id,
        bi.status,
        bi.staged_url,
        bi.staged_raw_url,
        bi.original_url,
        bi.prompt,
        bi.error,
        bi.started_at,
        bi.finished_at,
        pp.photo_filename,
        pp.zone,
        pp.room_type,
        pp.is_hero,
        pp.position
      FROM batch_items bi
      JOIN property_photos pp ON pp.id = bi.property_photo_id
      WHERE bi.batch_id = ${batchId}
      ORDER BY pp.position ASC
    `;

    return NextResponse.json({
      id: batch.id,
      status: batch.status,
      manifest: batch.manifest,
      model: batch.model,
      started_at: batch.started_at,
      finished_at: batch.finished_at,
      error: batch.error,
      property_id: batch.property_id,
      items,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/batches/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
