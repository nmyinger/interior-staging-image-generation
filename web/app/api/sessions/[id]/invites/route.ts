import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

async function verifyOwner(sessionId: string, uid: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM sessions WHERE id = ${sessionId} AND owner_user_id = ${uid}`;
  return rows.length > 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authSession = await getServerSession(authOptions);
  const uid = userId(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await verifyOwner(id, uid))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const inviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(["viewer", "editor"]).optional(),
  });

  const parsed = inviteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { email, role } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();
  const inviteRole = role === "editor" ? "editor" : "viewer";

  await sql`
    INSERT INTO session_invites (id, session_id, email, role)
    VALUES (${genId()}, ${id}, ${normalizedEmail}, ${inviteRole})
    ON CONFLICT (session_id, email) DO UPDATE SET role = EXCLUDED.role
  `;

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Delete all invites — used to reset the list; individual email deletion is via /invites/[email]
  const authSession = await getServerSession(authOptions);
  const uid = userId(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await verifyOwner(id, uid))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await sql`DELETE FROM session_invites WHERE session_id = ${id}`;
  return NextResponse.json({ ok: true });
}
