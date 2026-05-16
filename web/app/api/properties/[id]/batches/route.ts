import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID, type ModelId } from "@/lib/models";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

async function resolveProperty(propertyId: string, uid: string) {
  const userRows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
  const orgId = (userRows[0]?.default_org_id as string | null) ?? null;
  if (!orgId) return { property: null, orgId: null };

  const rows = await sql`
    SELECT * FROM properties WHERE id = ${propertyId} AND org_id = ${orgId}
  `;
  return { property: rows[0] ?? null, orgId };
}

// GET /api/properties/[id]/batches — list batches for this property
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id: propertyId } = await params;
    const { property } = await resolveProperty(propertyId, uid);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const batches = await sql`
      SELECT id, status, model, started_at, finished_at, error
      FROM batches
      WHERE property_id = ${propertyId}
      ORDER BY started_at DESC NULLS LAST
    `;

    return NextResponse.json({ batches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/properties/[id]/batches]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/properties/[id]/batches — create a batch and fire the Inngest event
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id: propertyId } = await params;
    const { property, orgId } = await resolveProperty(propertyId, uid);
    if (!property || !orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedModel = body.model as string | undefined;
    const model: string = ALLOWED_MODEL_IDS.includes(requestedModel as ModelId)
      ? requestedModel!
      : DEFAULT_MODEL_ID;
    const roomId: string | null = typeof body.roomId === "string" ? body.roomId : null;

    // Prefer unified path: query assets table
    const assetRows = roomId
      ? await sql`
          SELECT id, room_id, zone, room_type, is_hero, position, blob_url
          FROM assets
          WHERE property_id = ${propertyId} AND kind = 'source' AND room_id = ${roomId}
          ORDER BY position ASC
        `
      : await sql`
          SELECT id, room_id, zone, room_type, is_hero, position, blob_url
          FROM assets
          WHERE property_id = ${propertyId} AND kind = 'source'
          ORDER BY position ASC
        `;

    // Fall back to property_photos if no assets found (legacy properties)
    const useLegacy = assetRows.length === 0;

    if (useLegacy) {
      const photoRows = roomId
        ? await sql`
            SELECT pp.id, pp.photo_filename, ph.image_url, ph.original_url
            FROM property_photos pp
            JOIN photos ph ON ph.filename = pp.photo_filename
            WHERE pp.property_id = ${propertyId} AND pp.room_id = ${roomId}
            ORDER BY pp.position ASC
          `
        : await sql`
            SELECT pp.id, pp.photo_filename, ph.image_url, ph.original_url
            FROM property_photos pp
            JOIN photos ph ON ph.filename = pp.photo_filename
            WHERE pp.property_id = ${propertyId}
            ORDER BY pp.position ASC
          `;

      if (photoRows.length === 0) {
        return NextResponse.json(
          { error: roomId ? "No photos in this room — add photos first" : "No photos on this property — add photos first" },
          { status: 400 }
        );
      }

      const batchId = genId();
      await sql`
        INSERT INTO batches (id, property_id, org_id, status, model, created_by)
        VALUES (${batchId}, ${propertyId}, ${orgId}, 'queued', ${model}, ${uid})
      `;

      await Promise.all(
        photoRows.map(async (photo) => {
          const itemId = genId();
          const originalUrl = (photo.image_url as string | null) ?? "";
          await sql`
            INSERT INTO batch_items (id, batch_id, property_photo_id, status, original_url)
            VALUES (${itemId}, ${batchId}, ${photo.id as string}, 'queued', ${originalUrl})
          `;
        })
      );

      await sql`UPDATE properties SET status = 'queued' WHERE id = ${propertyId}`;
      await inngest.send({ name: "batch/run", data: { batchId } });
      return NextResponse.json({ batchId }, { status: 202 });
    }

    // Unified path: create batch + pre-create generation records
    const batchId = genId();
    await sql`
      INSERT INTO batches (id, property_id, org_id, status, model, room_id, created_by)
      VALUES (${batchId}, ${propertyId}, ${orgId}, 'queued', ${model}, ${roomId}, ${uid})
    `;

    // Create a generation per asset, sequenced within each room
    const roomSeqCounters: Record<string, number> = {};
    for (const asset of assetRows) {
      const assetRoomId = (asset.room_id as string | null) ?? "__no_room__";
      const seqIdx = roomSeqCounters[assetRoomId] ?? 0;
      roomSeqCounters[assetRoomId] = seqIdx + 1;

      const genRowId = genId();
      await sql`
        INSERT INTO generations (
          id, org_id, property_id, room_id, source_asset_id, batch_id,
          sequence_index, status, created_by
        ) VALUES (
          ${genRowId}, ${orgId}, ${propertyId},
          ${asset.room_id as string | null},
          ${asset.id as string},
          ${batchId},
          ${seqIdx},
          'queued',
          ${uid}
        )
      `;
    }

    await sql`UPDATE properties SET status = 'queued' WHERE id = ${propertyId}`;
    await inngest.send({ name: "batch/run", data: { batchId } });

    return NextResponse.json({ batchId }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/properties/[id]/batches]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
