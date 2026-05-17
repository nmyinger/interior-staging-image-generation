import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

async function resolveRoom(propertyId: string, roomId: string, uid: string) {
  const userRows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
  const orgId = (userRows[0]?.default_org_id as string | null) ?? null;
  if (!orgId) return null;

  const rows = await sql`
    SELECT pr.* FROM property_rooms pr
    JOIN properties p ON p.id = pr.property_id
    WHERE pr.id = ${roomId} AND pr.property_id = ${propertyId} AND p.org_id = ${orgId}
  `;
  return rows[0] ?? null;
}

// PATCH /api/properties/[id]/rooms/[roomId] — update name, prompt, or position
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, roomId } = await params;
    const room = await resolveRoom(id, roomId, uid);
    if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();

    if (typeof body.name === "string" && body.name.trim()) {
      await sql`UPDATE property_rooms SET name = ${body.name.trim()} WHERE id = ${roomId}`;
      await sql`UPDATE rooms SET name = ${body.name.trim()} WHERE id = ${roomId}`;
    }
    if (typeof body.prompt === "string") {
      await sql`UPDATE property_rooms SET prompt = ${body.prompt} WHERE id = ${roomId}`;
      await sql`UPDATE rooms SET prompt = ${body.prompt} WHERE id = ${roomId}`;
    }
    if (typeof body.position === "number") {
      await sql`UPDATE property_rooms SET position = ${body.position} WHERE id = ${roomId}`;
      await sql`UPDATE rooms SET position = ${body.position} WHERE id = ${roomId}`;
    }

    const rows = await sql`
      SELECT id, name, prompt, position, created_at FROM property_rooms WHERE id = ${roomId}
    `;
    return NextResponse.json(rows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/properties/[id]/rooms/[roomId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, roomId } = await params;
    const room = await resolveRoom(id, roomId, uid);
    if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await sql`DELETE FROM property_rooms WHERE id = ${roomId}`;
    await sql`DELETE FROM rooms WHERE id = ${roomId}`;
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
