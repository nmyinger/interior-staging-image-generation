import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId, migrate } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function GET() {
  await migrate();
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await sql`
    SELECT id, name, created_at FROM sessions
    WHERE owner_user_id = ${uid}
    ORDER BY created_at DESC
  `;
  return NextResponse.json({ sessions });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = genId();
  await sql`INSERT INTO sessions (id, owner_user_id, name) VALUES (${id}, ${uid}, 'Untitled')`;
  return NextResponse.json({ id });
}
