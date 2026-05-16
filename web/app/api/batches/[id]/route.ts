import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

// GET /api/batches/[id]
// Returns batch status + items (from generations if available, else batch_items for legacy batches)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id: batchId } = await params;

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

    // Try unified path: generations linked to this batch
    const genRows = await sql`
      SELECT
        g.id, g.status, g.error, g.prompt, g.started_at, g.finished_at,
        g.sequence_index,
        src.blob_url  AS source_blob_url,
        src.zone      AS zone,
        src.room_type AS room_type,
        src.is_hero   AS is_hero,
        src.position  AS position,
        out_a.blob_url AS output_blob_url
      FROM generations g
      LEFT JOIN assets src ON src.id = g.source_asset_id
      LEFT JOIN assets out_a ON out_a.id = g.output_asset_id
      WHERE g.batch_id = ${batchId}
      ORDER BY g.sequence_index ASC NULLS LAST
    `;

    if (genRows.length > 0) {
      const items = genRows.map(g => ({
        id: g.id as string,
        status: g.status as string,
        staged_url: (g.output_blob_url as string | null) ?? null,
        staged_raw_url: null,
        original_url: (g.source_blob_url as string | null) ?? null,
        prompt: g.prompt as string | null,
        error: g.error as string | null,
        started_at: g.started_at ? (g.started_at as Date).toISOString() : null,
        finished_at: g.finished_at ? (g.finished_at as Date).toISOString() : null,
        photo_filename: "",
        zone: g.zone as string | null,
        room_type: g.room_type as string | null,
        is_hero: (g.is_hero as boolean) ?? false,
        position: (g.sequence_index as number | null) ?? (g.position as number | null) ?? 0,
      }));

      // Derive batch status from generation statuses if batch still running
      let derivedStatus = batch.status as string;
      if (derivedStatus !== "done" && derivedStatus !== "failed") {
        const allDone = items.every(i => i.status === "done");
        const anyFailed = items.some(i => i.status === "failed");
        if (allDone) derivedStatus = "done";
        else if (anyFailed && items.every(i => i.status === "done" || i.status === "failed")) derivedStatus = "failed";
        else if (items.some(i => i.status === "running")) derivedStatus = "generating";
        else if (items.some(i => i.status === "queued")) derivedStatus = "analyzing";
      }

      return NextResponse.json({
        id: batch.id,
        status: derivedStatus,
        manifest: batch.manifest,
        model: batch.model,
        started_at: batch.started_at,
        finished_at: batch.finished_at,
        error: batch.error,
        property_id: batch.property_id,
        items,
      });
    }

    // Legacy path: batch_items
    const items = await sql`
      SELECT
        bi.id, bi.status, bi.staged_url, bi.staged_raw_url, bi.original_url,
        bi.prompt, bi.error, bi.started_at, bi.finished_at,
        pp.photo_filename, pp.zone, pp.room_type, pp.is_hero, pp.position
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
