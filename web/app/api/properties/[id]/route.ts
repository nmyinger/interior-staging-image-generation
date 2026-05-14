import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

async function resolveProperty(propertyId: string, uid: string) {
  const userRows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
  const orgId = (userRows[0]?.default_org_id as string | null) ?? null;
  if (!orgId) return null;

  const rows = await sql`
    SELECT * FROM properties WHERE id = ${propertyId} AND org_id = ${orgId}
  `;
  return rows[0] ?? null;
}

// GET /api/properties/[id] — property detail + photos + latest batch status
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const property = await resolveProperty(id, uid);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [photos, batches] = await Promise.all([
      sql`
        SELECT
          pp.id, pp.photo_filename, pp.room_type, pp.zone, pp.is_hero, pp.position,
          ph.image_url, ph.original_url, ph.mime_type
        FROM property_photos pp
        JOIN photos ph ON ph.filename = pp.photo_filename
        WHERE pp.property_id = ${id}
        ORDER BY pp.position ASC
      `,
      sql`
        SELECT id, status, started_at, finished_at, error
        FROM batches
        WHERE property_id = ${id}
        ORDER BY started_at DESC NULLS LAST
        LIMIT 1
      `,
    ]);

    return NextResponse.json({
      ...property,
      photos,
      latest_batch: batches[0] ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/properties/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/properties/[id] — update name, address, mls, style_brief
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const property = await resolveProperty(id, uid);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const updates: string[] = [];

    // Only apply provided fields
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

    void updates; // suppress unused variable lint

    const rows = await sql`
      SELECT id, name, address, mls, status, style_brief, created_at
      FROM properties WHERE id = ${id}
    `;
    return NextResponse.json(rows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/properties/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/properties/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const property = await resolveProperty(id, uid);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await sql`DELETE FROM properties WHERE id = ${id}`;
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/properties/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
