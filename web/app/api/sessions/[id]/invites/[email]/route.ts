import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; email: string }> }
) {
  const authSession = await getServerSession(authOptions);
  const uid = userId(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, email } = await params;

  const ownerRows = await sql`SELECT 1 FROM sessions WHERE id = ${id} AND owner_user_id = ${uid}`;
  if (!ownerRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const normalizedEmail = decodeURIComponent(email).toLowerCase().trim();
  await sql`DELETE FROM session_invites WHERE session_id = ${id} AND email = ${normalizedEmail}`;

  return NextResponse.json({ ok: true });
}
