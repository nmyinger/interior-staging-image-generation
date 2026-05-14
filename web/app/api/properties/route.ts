import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

// GET /api/properties — list properties for the authenticated user's org
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Resolve the user's default org
    const userRows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
    const orgId = (userRows[0]?.default_org_id as string | null) ?? null;

    if (!orgId) {
      return NextResponse.json({ properties: [] });
    }

    const properties = await sql`
      SELECT id, name, address, mls, status, created_at
      FROM properties
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ properties });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/properties]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/properties — create a new property
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const name: string = body.name ?? "";
    if (!name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const address: string | null = body.address ?? null;
    const mls: string | null = body.mls ?? null;
    const styleBrief = body.style_brief ?? {};

    // Resolve the user's default org
    const userRows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
    const orgId = (userRows[0]?.default_org_id as string | null) ?? null;

    if (!orgId) {
      return NextResponse.json(
        { error: "User has no organization — create or join an org first" },
        { status: 400 }
      );
    }

    const id = genId();
    await sql`
      INSERT INTO properties (id, org_id, created_by, name, address, mls, style_brief, status)
      VALUES (
        ${id},
        ${orgId},
        ${uid},
        ${name},
        ${address},
        ${mls},
        ${JSON.stringify(styleBrief)},
        'draft'
      )
    `;

    const rows = await sql`
      SELECT id, name, address, mls, status, created_at
      FROM properties WHERE id = ${id}
    `;

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/properties]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
