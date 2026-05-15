import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { sql } from "@/lib/db";

async function resolveProperty(propertyId: string, orgId: string) {
  const rows = await sql`
    SELECT * FROM properties WHERE id = ${propertyId} AND org_id = ${orgId}
  `;
  return rows[0] ?? null;
}

// GET /api/v1/properties/[id] — single property with latest batch status
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(req, async (orgId) => {
    try {
      const { id } = await params;
      const property = await resolveProperty(id, orgId);
      if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const batches = await sql`
        SELECT id, status, started_at, finished_at, error
        FROM batches
        WHERE property_id = ${id}
        ORDER BY started_at DESC NULLS LAST
        LIMIT 1
      `;

      return NextResponse.json({
        ...property,
        latest_batch: batches[0] ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[GET /api/v1/properties/[id]]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

// PATCH /api/v1/properties/[id] — update name/address/style_brief
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(req, async (orgId) => {
    try {
      const { id } = await params;
      const property = await resolveProperty(id, orgId);
      if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const body = await req.json().catch(() => ({}));

      if (typeof body.name === "string" && body.name.trim()) {
        await sql`UPDATE properties SET name = ${body.name} WHERE id = ${id}`;
      }
      if (body.address !== undefined) {
        await sql`UPDATE properties SET address = ${body.address ?? null} WHERE id = ${id}`;
      }
      if (body.mls !== undefined) {
        await sql`UPDATE properties SET mls = ${body.mls ?? null} WHERE id = ${id}`;
      }
      if (body.style_brief !== undefined) {
        await sql`UPDATE properties SET style_brief = ${JSON.stringify(body.style_brief)} WHERE id = ${id}`;
      }

      const rows = await sql`
        SELECT id, name, address, mls, status, style_brief, created_at
        FROM properties WHERE id = ${id}
      `;
      return NextResponse.json(rows[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[PATCH /api/v1/properties/[id]]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
