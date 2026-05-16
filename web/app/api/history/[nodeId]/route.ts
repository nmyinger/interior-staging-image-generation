import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import {
  resolveAccess,
  resolvePropertyAccess,
  verifyPasswordCookie,
  passwordCookieName,
  propertyPasswordCookieName,
} from "@/lib/access";

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

  // ─── Unified path: nodeId is a generation ID ────────────────────────────────
  const genRows = await sql`
    SELECT id, property_id, parent_generation_id FROM generations
    WHERE id = ${nodeId} AND parent_generation_id IS NULL
  `;

  if (genRows.length > 0) {
    const propertyId = genRows[0].property_id as string;
    const access = await resolvePropertyAccess(propertyId, uid, email);
    if (!access.canRead) return NextResponse.json({ history: [] });

    if (access.needsPassword && access.passwordHash) {
      const cookieValue = req.cookies.get(propertyPasswordCookieName(propertyId))?.value;
      if (!verifyPasswordCookie(cookieValue, propertyId, access.passwordHash)) {
        return NextResponse.json({ error: "Password required" }, { status: 401 });
      }
    }

    // Walk parent_generation_id chain (parent holds older outputs)
    const history: Array<{ id: string; outputUrl?: string; createdAt: string }> = [];
    let cursor: string | null = genRows[0].parent_generation_id as string | null;
    while (cursor && history.length < 20) {
      const parentRows = await sql`
        SELECT id, output_asset_id, parent_generation_id, created_at
        FROM generations WHERE id = ${cursor}
      `;
      if (!parentRows.length) break;
      const parent = parentRows[0];

      let outputUrl: string | undefined;
      if (parent.output_asset_id) {
        const assetRows = await sql`SELECT blob_url FROM assets WHERE id = ${parent.output_asset_id as string}`;
        outputUrl = assetRows[0]?.blob_url as string | undefined;
      }

      history.push({
        id: parent.id as string,
        outputUrl,
        createdAt: (parent.created_at as Date).toISOString(),
      });
      cursor = parent.parent_generation_id as string | null;
    }

    return NextResponse.json({ history });
  }

  // ─── Legacy path: canvas_nodes ───────────────────────────────────────────────
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
