import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uid = (session.user as { id?: string }).id ?? "";
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Resolve the user's org
  const orgRows = (await sql`
    SELECT o.id
    FROM orgs o
    JOIN org_members om ON om.org_id = o.id
    WHERE om.user_id = ${uid} AND om.status = 'active'
    ORDER BY om.created_at ASC
    LIMIT 1
  `) as { id: string }[];

  const org = orgRows[0] ?? null;
  if (!org) {
    return NextResponse.json({ error: "No organization found" }, { status: 403 });
  }

  // Verify the disclosure belongs to the user's org and exists
  const disclosureRows = (await sql`
    SELECT id, revoked_at
    FROM disclosures
    WHERE id = ${id} AND org_id = ${org.id}
    LIMIT 1
  `) as { id: string; revoked_at: string | null }[];

  if (!disclosureRows.length) {
    return NextResponse.json({ error: "Disclosure not found" }, { status: 404 });
  }

  // Set revoked_at
  await sql`
    UPDATE disclosures
    SET revoked_at = NOW()
    WHERE id = ${id} AND org_id = ${org.id}
  `;

  return NextResponse.json({ ok: true });
}
