import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { resolveAccess, verifyPasswordCookie, passwordCookieName } from "@/lib/access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getUidEmail(session: any) {
  const user = session?.user as { id?: string; email?: string } | undefined;
  return { uid: user?.id ?? null, email: user?.email ?? null };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const authSession = await getServerSession(authOptions);
  const { uid, email } = getUidEmail(authSession);

  const { nodeId } = await params;

  const nodeRows = await sql`SELECT session_id FROM canvas_nodes WHERE id = ${nodeId}`;
  if (!nodeRows.length) return NextResponse.json({ history: [] });

  const sessionId = nodeRows[0].session_id as string;

  const access = await resolveAccess(sessionId, uid, email);
  if (!access.canRead) return NextResponse.json({ history: [] });

  if (access.needsPassword && access.passwordHash) {
    const cookieValue = req.cookies.get(passwordCookieName(sessionId))?.value;
    if (!verifyPasswordCookie(cookieValue, sessionId, access.passwordHash)) {
      return NextResponse.json({ error: "Password required" }, { status: 401 });
    }
  }

  const rows = await sql`
    SELECT id, output_url, output_b64, created_at
    FROM generation_history
    WHERE node_id = ${nodeId}
    ORDER BY created_at DESC
  `;

  const history = rows.map(r => ({
    id: r.id as string,
    outputUrl: (r.output_url as string | null) ?? undefined,
    outputB64: (r.output_b64 as string | null) || undefined,
    createdAt: (r.created_at as Date).toISOString(),
  }));

  return NextResponse.json({ history });
}
