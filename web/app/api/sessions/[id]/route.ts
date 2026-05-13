import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  await sql`
    UPDATE sessions SET name = ${name.trim()}
    WHERE id = ${id} AND owner_user_id = ${uid}
  `;
  return NextResponse.json({ ok: true });
}
