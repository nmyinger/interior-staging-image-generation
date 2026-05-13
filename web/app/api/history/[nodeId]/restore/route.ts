import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nodeId } = await params;
  const { historyId } = await req.json() as { historyId: string };
  if (!historyId) return NextResponse.json({ error: "historyId required" }, { status: 400 });

  // Verify node ownership and read current outputB64
  const nodeRows = await sql`
    SELECT n.session_id, n.data->>'outputB64' AS current_b64
    FROM canvas_nodes n
    JOIN sessions s ON s.id = n.session_id
    WHERE n.id = ${nodeId} AND s.owner_user_id = ${uid}
  `;
  if (!nodeRows.length) return NextResponse.json({ error: "Node not found" }, { status: 404 });

  const { session_id: sessionId, current_b64: currentB64 } = nodeRows[0] as {
    session_id: string;
    current_b64: string | null;
  };

  // Get the history entry to restore
  const histRows = await sql`
    SELECT id, output_b64 FROM generation_history
    WHERE id = ${historyId} AND node_id = ${nodeId}
  `;
  if (!histRows.length) return NextResponse.json({ error: "History entry not found" }, { status: 404 });

  const historyOutputB64 = histRows[0].output_b64 as string;

  // Push current output into history before overwriting (swap, not delete)
  if (currentB64 && currentB64 !== historyOutputB64) {
    await sql`
      INSERT INTO generation_history (id, node_id, session_id, output_b64, created_at)
      VALUES (${genId()}, ${nodeId}, ${sessionId}, ${currentB64}, NOW())
    `;
  }

  // Remove the restored entry from history (it's now current)
  await sql`DELETE FROM generation_history WHERE id = ${historyId}`;

  // Update node's current output
  await sql`
    UPDATE canvas_nodes
    SET data = data || jsonb_build_object('outputB64', ${historyOutputB64}::text, 'status', 'done')
    WHERE id = ${nodeId}
  `;

  return NextResponse.json({ outputB64: historyOutputB64 });
}
