import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";
import { resolveAccess } from "@/lib/access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getUidEmail(session: any) {
  const user = session?.user as { id?: string; email?: string } | undefined;
  return { uid: user?.id ?? null, email: user?.email ?? null };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const authSession = await getServerSession(authOptions);
  const { uid, email } = getUidEmail(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nodeId } = await params;
  const { historyId } = await req.json() as { historyId: string };
  if (!historyId) return NextResponse.json({ error: "historyId required" }, { status: 400 });

  // Resolve node + session
  const nodeRows = await sql`
    SELECT session_id, data->>'outputB64' AS current_b64 FROM canvas_nodes WHERE id = ${nodeId}
  `;
  if (!nodeRows.length) return NextResponse.json({ error: "Node not found" }, { status: 404 });

  const { session_id: sessionId, current_b64: currentB64 } = nodeRows[0] as {
    session_id: string;
    current_b64: string | null;
  };

  const access = await resolveAccess(sessionId, uid, email);
  if (!access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const histRows = await sql`
    SELECT id, output_b64 FROM generation_history
    WHERE id = ${historyId} AND node_id = ${nodeId}
  `;
  if (!histRows.length) return NextResponse.json({ error: "History entry not found" }, { status: 404 });

  const historyOutputB64 = histRows[0].output_b64 as string;

  if (currentB64 && currentB64 !== historyOutputB64) {
    await sql`
      INSERT INTO generation_history (id, node_id, session_id, output_b64, created_at)
      VALUES (${genId()}, ${nodeId}, ${sessionId}, ${currentB64}, NOW())
    `;
  }

  await sql`DELETE FROM generation_history WHERE id = ${historyId}`;

  await sql`
    UPDATE canvas_nodes
    SET data = data || jsonb_build_object('outputB64', ${historyOutputB64}::text, 'status', 'done')
    WHERE id = ${nodeId}
  `;

  return NextResponse.json({ outputB64: historyOutputB64 });
}
