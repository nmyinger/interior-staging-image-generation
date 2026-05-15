import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { sql, genId } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID, type ModelId } from "@/lib/models";

async function resolveProperty(propertyId: string, orgId: string) {
  const rows = await sql`
    SELECT id FROM properties WHERE id = ${propertyId} AND org_id = ${orgId}
  `;
  return rows[0] ?? null;
}

// GET /api/v1/properties/[id]/batches — list batches for a property
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(req, async (orgId) => {
    try {
      const { id: propertyId } = await params;
      const property = await resolveProperty(propertyId, orgId);
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
      console.error("[GET /api/v1/properties/[id]/batches]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

// POST /api/v1/properties/[id]/batches — create and fire a batch
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(req, async (orgId) => {
    try {
      const { id: propertyId } = await params;
      const property = await resolveProperty(propertyId, orgId);
      if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const body = await req.json().catch(() => ({}));
      const requestedModel = body.model as string | undefined;
      const model: string = ALLOWED_MODEL_IDS.includes(requestedModel as ModelId)
        ? requestedModel!
        : DEFAULT_MODEL_ID;

      // Fetch all property_photos
      const photoRows = await sql`
        SELECT pp.id, pp.photo_filename, ph.image_url, ph.original_url
        FROM property_photos pp
        JOIN photos ph ON ph.filename = pp.photo_filename
        WHERE pp.property_id = ${propertyId}
        ORDER BY pp.position ASC
      `;

      if (photoRows.length === 0) {
        return NextResponse.json(
          { error: "No photos on this property — add photos first" },
          { status: 400 }
        );
      }

      // Create the batch record
      const batchId = genId();
      await sql`
        INSERT INTO batches (id, property_id, org_id, status, model)
        VALUES (${batchId}, ${propertyId}, ${orgId}, 'queued', ${model})
      `;

      // Create batch_items for each photo
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

      // Update property status to queued
      await sql`UPDATE properties SET status = 'queued' WHERE id = ${propertyId}`;

      // Fire the Inngest event
      await inngest.send({ name: "batch/run", data: { batchId } });

      return NextResponse.json({ batch_id: batchId }, { status: 202 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[POST /api/v1/properties/[id]/batches]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
