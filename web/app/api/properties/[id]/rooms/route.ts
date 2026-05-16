import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

async function resolveProperty(propertyId: string, uid: string) {
  const userRows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
  const orgId = (userRows[0]?.default_org_id as string | null) ?? null;
  if (!orgId) return null;
  const rows = await sql`SELECT * FROM properties WHERE id = ${propertyId} AND org_id = ${orgId}`;
  return rows[0] ?? null;
}

// GET /api/properties/[id]/rooms
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const property = await resolveProperty(id, uid);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rooms = await sql`
      SELECT id, name, prompt, position, created_at
      FROM property_rooms
      WHERE property_id = ${id}
      ORDER BY position ASC, created_at ASC
    `;
    return NextResponse.json({ rooms });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/properties/[id]/rooms — create a new room
export async function POST(
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
    const name: string = (body.name ?? "New Room").trim() || "New Room";

    const countRows = await sql`
      SELECT COUNT(*) AS cnt FROM property_rooms WHERE property_id = ${id}
    `;
    const position = Number((countRows[0] as { cnt: unknown })?.cnt ?? 0);

    const roomId = genId();
    await sql`
      INSERT INTO property_rooms (id, property_id, name, prompt, position)
      VALUES (${roomId}, ${id}, ${name}, '', ${position})
    `;

    const rows = await sql`
      SELECT id, name, prompt, position, created_at FROM property_rooms WHERE id = ${roomId}
    `;
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
