import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await sql`DELETE FROM sessions WHERE id = ${id} AND owner_user_id = ${uid}`;
  return NextResponse.json({ ok: true });
}

const renameSchema = z.object({
  name: z.string().min(1).max(200),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = renameSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { name } = parsed.data;
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  await sql`
    UPDATE sessions SET name = ${name.trim()}
    WHERE id = ${id} AND owner_user_id = ${uid}
  `;
  return NextResponse.json({ ok: true });
}
