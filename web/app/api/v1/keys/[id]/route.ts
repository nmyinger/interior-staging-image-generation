import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

async function resolveOrgId(uid: string): Promise<string | null> {
  const rows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
  return (rows[0]?.default_org_id as string | null) ?? null;
}

// DELETE /api/v1/keys/[id] — revoke (soft-delete) an API key
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const orgId = await resolveOrgId(uid);
    if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Verify key belongs to this org and is not already revoked
    const rows = await sql`
      SELECT id FROM api_keys
      WHERE id = ${id} AND org_id = ${orgId} AND revoked_at IS NULL
    `;
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await sql`UPDATE api_keys SET revoked_at = NOW() WHERE id = ${id}`;

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/v1/keys/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
