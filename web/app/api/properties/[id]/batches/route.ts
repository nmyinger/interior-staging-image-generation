import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID, type ModelId } from "@/lib/models";
import { isBlobConfigured } from "@/lib/storage";

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

    // Always use the unified path: property_photos is the source of truth for which
    // photos belong to a property, regardless of whether an assets row exists yet.
    const photoRows = roomId
      ? await sql`
          SELECT pp.id, pp.room_id, pp.zone, pp.room_type, pp.is_hero, pp.position,
                 p.image_url, p.image_b64, p.mime_type
          FROM property_photos pp
          JOIN photos p ON p.filename = pp.photo_filename
          WHERE pp.property_id = ${propertyId} AND pp.room_id = ${roomId}
          ORDER BY pp.position ASC
        `
      : await sql`
          SELECT pp.id, pp.room_id, pp.zone, pp.room_type, pp.is_hero, pp.position,
                 p.image_url, p.image_b64, p.mime_type
          FROM property_photos pp
          JOIN photos p ON p.filename = pp.photo_filename
          WHERE pp.property_id = ${propertyId}
          ORDER BY pp.position ASC
        `;

    if (photoRows.length === 0) {
      return NextResponse.json(
        { error: roomId ? "No photos in this room — add photos first" : "No photos on this property — add photos first" },
        { status: 400 }
      );
    }

    // Ensure every photo has a corresponding source asset row.
    // Photos uploaded before dual-write or in dev (b64 path) may not have one yet.
    const assetIds = photoRows.map(p => `ast_pp_${p.id as string}`);
    const existingAssetRows = await sql`SELECT id FROM assets WHERE id = ANY(${assetIds})`;
    const existingAssetIds = new Set((existingAssetRows as { id: string }[]).map(r => r.id));
    const inlineBase = isBlobConfigured()
      ? (process.env.NEXTAUTH_URL ?? "http://localhost:3000")
      : (process.env.NEXTAUTH_URL ?? "http://localhost:3000");

    for (const photo of photoRows) {
      const assetId = `ast_pp_${photo.id as string}`;
      if (existingAssetIds.has(assetId)) continue;

      const imageUrl = photo.image_url as string | null;
      const imageB64 = photo.image_b64 as string | null;
      const mimeType = (photo.mime_type as string | null) ?? "image/jpeg";

      const blobUrl = imageUrl ?? (imageB64 ? `${inlineBase}/api/assets/${assetId}/inline` : null);
      if (!blobUrl) continue;

      await sql`
        INSERT INTO assets (id, org_id, property_id, room_id, kind, mime_type, blob_url,
                            zone, room_type, position, is_hero, uploaded_by)
        VALUES (${assetId}, ${orgId}, ${propertyId}, ${photo.room_id as string | null},
                'source', ${mimeType}, ${blobUrl},
                ${photo.zone as string | null}, ${photo.room_type as string | null},
                ${photo.position as number}, ${photo.is_hero as boolean}, ${uid})
        ON CONFLICT (id) DO NOTHING
      `;

      if (!imageUrl && imageB64) {
        await sql`
          INSERT INTO asset_inline_data (asset_id, mime_type, data_b64)
          VALUES (${assetId}, ${mimeType}, ${imageB64})
          ON CONFLICT (asset_id) DO UPDATE SET data_b64 = EXCLUDED.data_b64, mime_type = EXCLUDED.mime_type
        `;
      }
    }

    // Create batch + one generation per photo, sequenced within each room.
    const batchId = genId();
    await sql`
      INSERT INTO batches (id, property_id, org_id, status, model, room_id, created_by)
      VALUES (${batchId}, ${propertyId}, ${orgId}, 'queued', ${model}, ${roomId}, ${uid})
    `;

    const roomSeqCounters: Record<string, number> = {};
    for (const photo of photoRows) {
      const assetId = `ast_pp_${photo.id as string}`;
      const ppRoomId = (photo.room_id as string | null) ?? "__no_room__";
      const seqIdx = roomSeqCounters[ppRoomId] ?? 0;
      roomSeqCounters[ppRoomId] = seqIdx + 1;

      const genRowId = genId();
      await sql`
        INSERT INTO generations (id, org_id, property_id, room_id, source_asset_id,
                                  batch_id, sequence_index, status, created_by)
        VALUES (${genRowId}, ${orgId}, ${propertyId}, ${photo.room_id as string | null},
                ${assetId}, ${batchId}, ${seqIdx}, 'queued', ${uid})
      `;

      // Seed the base input edge so canvas shows source→generation connection immediately
      await sql`
        INSERT INTO generation_inputs (generation_id, asset_id, role, ord)
        VALUES (${genRowId}, ${assetId}, 'base', 0)
        ON CONFLICT DO NOTHING
      `;
    }

    await sql`UPDATE properties SET status = 'queued' WHERE id = ${propertyId}`;
    await inngest.send({ name: "batch/run", data: { batchId } });

    if (process.env.NODE_ENV !== "production") {
      const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      after(async () => {
        try {
          await fetch(`${baseUrl}/api/batches/${batchId}/run`, { method: "POST" });
        } catch {
          // best-effort dev fallback
        }
      });
    }

    return NextResponse.json({ batchId }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/properties/[id]/batches]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
