import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nodeId } = await params;

  const rows = await sql`
    SELECT gh.id, gh.output_b64, gh.created_at
    FROM generation_history gh
    JOIN canvas_nodes n ON n.id = gh.node_id
    JOIN sessions s ON s.id = n.session_id
    WHERE gh.node_id = ${nodeId} AND s.owner_user_id = ${uid}
    ORDER BY gh.created_at DESC
  `;

  const history = rows.map(r => ({
    id: r.id as string,
    outputB64: r.output_b64 as string,
    createdAt: (r.created_at as Date).toISOString(),
  }));

  return NextResponse.json({ history });
}
