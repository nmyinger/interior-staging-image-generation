import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId, migrate } from "@/lib/db";
import { z } from "zod";

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

const createSessionSchema = z.object({
  name: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let sessionName = "Untitled";
  // Only parse body if content is provided
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 0) {
    const parsed = createSessionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    if (parsed.data.name) sessionName = parsed.data.name;
  }

  const id = genId();
  await sql`INSERT INTO sessions (id, owner_user_id, name) VALUES (${id}, ${uid}, ${sessionName})`;
  return NextResponse.json({ id });
}
