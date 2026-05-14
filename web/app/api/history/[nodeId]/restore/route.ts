import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";
import { resolveAccess } from "@/lib/access";
import { z } from "zod";

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

  const restoreSchema = z.object({
    historyId: z.string(),
  });

  const parsed = restoreSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { historyId } = parsed.data;

  const nodeRows = await sql`
    SELECT session_id, data->>'outputUrl' AS current_url, data->>'outputB64' AS current_b64
    FROM canvas_nodes WHERE id = ${nodeId}
  `;
  if (!nodeRows.length) return NextResponse.json({ error: "Node not found" }, { status: 404 });

  const { session_id: sessionId, current_url: currentUrl, current_b64: currentB64 } = nodeRows[0] as {
    session_id: string;
    current_url: string | null;
    current_b64: string | null;
  };

  const access = await resolveAccess(sessionId, uid, email);
  if (!access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const histRows = await sql`
    SELECT id, output_url, output_b64 FROM generation_history
    WHERE id = ${historyId} AND node_id = ${nodeId}
  `;
  if (!histRows.length) return NextResponse.json({ error: "History entry not found" }, { status: 404 });

  const { output_url: histOutputUrl, output_b64: histOutputB64 } = histRows[0] as {
    output_url: string | null;
    output_b64: string | null;
  };

  const histHasContent = !!(histOutputUrl || histOutputB64);
  const currentHasContent = !!(currentUrl || currentB64);
  const isSame = (currentUrl && currentUrl === histOutputUrl) || (currentB64 && currentB64 === histOutputB64);

  if (currentHasContent && !isSame) {
    await sql`
      INSERT INTO generation_history (id, node_id, session_id, output_url, output_b64, created_at)
      VALUES (${genId()}, ${nodeId}, ${sessionId}, ${currentUrl ?? null}, ${currentB64 ?? ''}, NOW())
    `;
  }

  await sql`DELETE FROM generation_history WHERE id = ${historyId}`;

  if (histOutputUrl) {
    await sql`
      UPDATE canvas_nodes
      SET data = data || jsonb_build_object('outputUrl', ${histOutputUrl}::text, 'status', 'done')
      WHERE id = ${nodeId}
    `;
    if (!histHasContent) await sql`
      UPDATE canvas_nodes SET data = data - 'outputB64' WHERE id = ${nodeId}
    `;
  } else if (histOutputB64) {
    await sql`
      UPDATE canvas_nodes
      SET data = data || jsonb_build_object('outputB64', ${histOutputB64}::text, 'status', 'done')
      WHERE id = ${nodeId}
    `;
  }

  return NextResponse.json({
    outputUrl: histOutputUrl ?? undefined,
    outputB64: histOutputB64 ?? undefined,
  });
}
