/**
 * GET  /api/canvas  — load saved edges + generation states
 * POST /api/canvas  — save edges + node positions
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const [edges, generations] = await Promise.all([
    sql`SELECT id, source_node, source_handle, target_node, target_handle FROM edges`,
    sql`SELECT filename, prompt, output_b64, node_x, node_y FROM generations`,
  ]);

  return NextResponse.json({ edges, generations });
}

export async function POST(req: NextRequest) {
  const { edges, nodePositions } = await req.json() as {
    edges: Array<{ id: string; source: string; sourceHandle?: string; target: string; targetHandle?: string }>;
    nodePositions: Array<{ filename: string; x: number; y: number }>;
  };

  // Replace all edges
  await sql`DELETE FROM edges`;
  for (const e of edges) {
    await sql`
      INSERT INTO edges (id, source_node, source_handle, target_node, target_handle)
      VALUES (${e.id}, ${e.source}, ${e.sourceHandle ?? null}, ${e.target}, ${e.targetHandle ?? null})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  // Upsert node positions
  for (const pos of nodePositions) {
    await sql`
      INSERT INTO generations (filename, node_x, node_y)
      VALUES (${pos.filename}, ${pos.x}, ${pos.y})
      ON CONFLICT (filename) DO UPDATE
        SET node_x = EXCLUDED.node_x,
            node_y = EXCLUDED.node_y
    `;
  }

  return NextResponse.json({ ok: true });
}
