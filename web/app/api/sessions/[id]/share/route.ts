import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { hashPassword } from "@/lib/access";
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authSession = await getServerSession(authOptions);
  const uid = userId(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const rows = await sql`
    SELECT link_access, share_password_hash IS NOT NULL AS has_password
    FROM sessions WHERE id = ${id} AND owner_user_id = ${uid}
  `;
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const inviteRows = await sql`
    SELECT email, role FROM session_invites WHERE session_id = ${id} ORDER BY created_at
  `;

  return NextResponse.json({
    linkAccess: rows[0].link_access,
    hasPassword: rows[0].has_password,
    invites: inviteRows.map(r => ({ email: r.email as string, role: r.role as string })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authSession = await getServerSession(authOptions);
  const uid = userId(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const ownerRows = await sql`SELECT 1 FROM sessions WHERE id = ${id} AND owner_user_id = ${uid}`;
  if (!ownerRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const shareSchema = z.object({
    linkAccess: z.enum(["private", "view", "edit"]).optional(),
    password: z.string().optional(),
    removePassword: z.boolean().optional(),
  });

  const parsed = shareSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  if (body.linkAccess !== undefined) {
    await sql`UPDATE sessions SET link_access = ${body.linkAccess} WHERE id = ${id}`;
  }

  if (body.removePassword) {
    await sql`UPDATE sessions SET share_password_hash = NULL WHERE id = ${id}`;
  } else if (body.password) {
    const hash = hashPassword(body.password);
    await sql`UPDATE sessions SET share_password_hash = ${hash} WHERE id = ${id}`;
  }

  return NextResponse.json({ ok: true });
}
