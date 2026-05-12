import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [edges, generations] = await Promise.all([
    sql`SELECT id, source_node, source_handle, target_node, target_handle FROM edges WHERE user_id = ${uid}`,
    sql`SELECT filename, prompt, output_b64, node_x, node_y FROM generations WHERE user_id = ${uid}`,
  ]);

  return NextResponse.json({ edges, generations });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { edges, nodePositions } = await req.json() as {
    edges: Array<{ id: string; source: string; sourceHandle?: string; target: string; targetHandle?: string }>;
    nodePositions: Array<{ filename: string; x: number; y: number; prompt?: string }>;
  };

  await sql`DELETE FROM edges WHERE user_id = ${uid}`;
  for (const e of edges) {
    await sql`
      INSERT INTO edges (user_id, id, source_node, source_handle, target_node, target_handle)
      VALUES (${uid}, ${e.id}, ${e.source}, ${e.sourceHandle ?? null}, ${e.target}, ${e.targetHandle ?? null})
      ON CONFLICT (user_id, id) DO NOTHING
    `;
  }

  for (const pos of nodePositions) {
    await sql`
      INSERT INTO generations (user_id, filename, node_x, node_y, prompt)
      VALUES (${uid}, ${pos.filename}, ${pos.x}, ${pos.y}, ${pos.prompt ?? ""})
      ON CONFLICT (user_id, filename) DO UPDATE
        SET node_x = EXCLUDED.node_x,
            node_y = EXCLUDED.node_y,
            prompt = EXCLUDED.prompt
    `;
  }

  return NextResponse.json({ ok: true });
}
