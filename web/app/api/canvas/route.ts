import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

async function verifySession(sessionId: string, uid: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM sessions WHERE id = ${sessionId} AND owner_user_id = ${uid}`;
  return rows.length > 0;
}

export async function GET(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  const uid = userId(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  if (!(await verifySession(sessionId, uid))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [nodes, edges] = await Promise.all([
    sql`SELECT id, type, x, y, data FROM canvas_nodes WHERE session_id = ${sessionId} ORDER BY created_at`,
    sql`SELECT id, source, source_handle, target, target_handle FROM canvas_edges WHERE session_id = ${sessionId}`,
  ]);

  return NextResponse.json({ nodes, edges });
}

export async function POST(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  const uid = userId(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId, nodes, edges } = await req.json() as {
    sessionId: string;
    nodes: Array<{ id: string; type: string; x: number; y: number; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; sourceHandle: string; target: string; targetHandle: string }>;
  };

  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  if (!(await verifySession(sessionId, uid))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Upsert all current nodes
  for (const n of nodes) {
    await sql`
      INSERT INTO canvas_nodes (id, session_id, type, x, y, data)
      VALUES (${n.id}, ${sessionId}, ${n.type}, ${n.x}, ${n.y}, ${JSON.stringify(n.data)})
      ON CONFLICT (id) DO UPDATE
        SET x = EXCLUDED.x, y = EXCLUDED.y,
            data = canvas_nodes.data || EXCLUDED.data
    `;
  }

  // Delete nodes no longer on the canvas
  if (nodes.length > 0) {
    const ids = nodes.map(n => n.id);
    await sql`DELETE FROM canvas_nodes WHERE session_id = ${sessionId} AND id != ALL(${ids})`;
  } else {
    await sql`DELETE FROM canvas_nodes WHERE session_id = ${sessionId}`;
  }

  // Replace all edges
  await sql`DELETE FROM canvas_edges WHERE session_id = ${sessionId}`;
  for (const e of edges) {
    await sql`
      INSERT INTO canvas_edges (id, session_id, source, source_handle, target, target_handle)
      VALUES (${e.id}, ${sessionId}, ${e.source}, ${e.sourceHandle}, ${e.target}, ${e.targetHandle})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  return NextResponse.json({ ok: true });
}
