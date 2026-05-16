import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import {
  resolvePropertyAccess,
  verifyPasswordCookie,
  propertyPasswordCookieName,
  // Keep backward-compat helpers for legacy session-based canvas reads
  resolveAccess,
  passwordCookieName,
} from "@/lib/access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getUidEmail(session: any) {
  const user = session?.user as { id?: string; email?: string } | undefined;
  return { uid: user?.id ?? null, email: user?.email ?? null };
}

// ---------------------------------------------------------------------------
// GET /api/canvas?propertyId=X   — unified model (new)
// GET /api/canvas?sessionId=X    — legacy (still supported via sessions_legacy lookup)
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  const { uid, email } = getUidEmail(authSession);

  const rawPropertyId = req.nextUrl.searchParams.get("propertyId");
  const rawSessionId  = req.nextUrl.searchParams.get("sessionId");

  // Support legacy sessionId param — resolve to propertyId via sessions_legacy
  let propertyId = rawPropertyId;
  if (!propertyId && rawSessionId) {
    const legacyRows = await sql`
      SELECT property_id FROM sessions_legacy WHERE session_id = ${rawSessionId}
    `;
    if (legacyRows.length) {
      propertyId = legacyRows[0].property_id as string;
    } else {
      // Fall back to old canvas_nodes query so nothing breaks during transition
      return legacyCanvasGet(req, rawSessionId, uid, email);
    }
  }

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const access = await resolvePropertyAccess(propertyId, uid, email);
  if (!access.canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (access.needsPassword && access.passwordHash) {
    const cookie = req.cookies.get(propertyPasswordCookieName(propertyId))?.value;
    if (!verifyPasswordCookie(cookie, propertyId, access.passwordHash)) {
      return NextResponse.json({ error: "Password required" }, { status: 401 });
    }
  }

  const [assetRows, genRows, layoutRows] = await Promise.all([
    sql`
      SELECT id, kind, blob_url, mime_type, sha256, zone, room_type, room_id, is_hero, position
      FROM assets
      WHERE property_id = ${propertyId} AND kind = 'source'
      ORDER BY position ASC
    `,
    sql`
      SELECT
        g.id, g.prompt, g.model, g.status, g.source_asset_id,
        g.output_asset_id, g.error, g.created_at,
        out_a.blob_url AS output_url,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'assetId', gi.asset_id,
            'role',    gi.role,
            'ord',     gi.ord
          ) ORDER BY gi.role, gi.ord)
           FROM generation_inputs gi
           WHERE gi.generation_id = g.id),
          '[]'::jsonb
        ) AS inputs
      FROM generations g
      LEFT JOIN assets out_a ON out_a.id = g.output_asset_id
      WHERE g.property_id = ${propertyId}
        AND g.parent_generation_id IS NULL
      ORDER BY g.created_at ASC
    `,
    sql`
      SELECT entity_kind, entity_id, x, y
      FROM canvas_layouts WHERE property_id = ${propertyId}
    `,
  ]);

  // Build layout lookup
  const layoutByKey = new Map<string, { x: number; y: number }>();
  for (const l of layoutRows) {
    layoutByKey.set(`${l.entity_kind as string}:${l.entity_id as string}`, {
      x: Number(l.x), y: Number(l.y),
    });
  }
  const pos = (kind: "asset" | "generation", id: string) =>
    layoutByKey.get(`${kind}:${id}`) ?? { x: 0, y: 0 };

  // Auto-layout for entities with no stored position: stack vertically
  let autoY = 0;
  const autoPos = (kind: "asset" | "generation", id: string) => {
    const stored = layoutByKey.get(`${kind}:${id}`);
    if (stored) return stored;
    const p = { x: kind === "asset" ? 50 : 420, y: autoY };
    autoY += 260;
    return p;
  };

  // Photo nodes (one per source asset)
  const photoNodes = assetRows.map((a) => ({
    id: a.id as string,
    type: "photo",
    position: autoPos("asset", a.id as string),
    data: {
      assetId: a.id as string,
      blobUrl: a.blob_url as string | null,
      mimeType: a.mime_type as string,
      zone: a.zone as string | null,
      roomType: a.room_type as string | null,
      roomId: a.room_id as string | null,
      isHero: a.is_hero as boolean,
      position: a.position as number,
    },
  }));

  // Generation nodes
  const genNodes = genRows.map((g) => ({
    id: g.id as string,
    type: "generation",
    position: pos("generation", g.id as string),
    data: {
      generationId: g.id as string,
      prompt: g.prompt as string,
      model: g.model as string | null,
      status: g.status as string,
      outputUrl: g.output_url as string | null,
      outputAssetId: g.output_asset_id as string | null,
      sourceAssetId: g.source_asset_id as string | null,
    },
  }));

  // Synthesize edges from generation_inputs
  type InputRow = { assetId: string; role: "base" | "reference" | "hero"; ord: number };
  const outputAssetToGenId = new Map<string, string>();
  for (const g of genRows) {
    if (g.output_asset_id) outputAssetToGenId.set(g.output_asset_id as string, g.id as string);
  }

  const edges: Array<{
    id: string; source: string; target: string;
    sourceHandle: string; targetHandle: string;
    type: string;
  }> = [];

  for (const g of genRows) {
    const genId = g.id as string;
    const inputs = (g.inputs ?? []) as InputRow[];
    for (const input of inputs) {
      const targetHandle = input.role === "base" ? "base" : "ref";
      // Is the source another generation's output, or a source asset?
      const sourceGenId = outputAssetToGenId.get(input.assetId);
      const source = sourceGenId ?? input.assetId;
      const sourceHandle = sourceGenId ? "output" : "photo";
      edges.push({
        id: `e_${genId}_${input.role}_${input.ord}`,
        source,
        target: genId,
        sourceHandle,
        targetHandle,
        type: "deletable",
      });
    }
  }

  return NextResponse.json({ nodes: [...photoNodes, ...genNodes], edges });
}

// ---------------------------------------------------------------------------
// POST /api/canvas — save canvas layout + generation graph changes
// Body: { propertyId, nodes, edges }  OR legacy { sessionId, nodes, edges }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  const { uid, email } = getUidEmail(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    propertyId?: string;
    sessionId?: string;
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; sourceHandle: string; target: string; targetHandle: string }>;
  };

  // Resolve propertyId (support legacy sessionId)
  let propertyId = body.propertyId;
  if (!propertyId && body.sessionId) {
    const legacyRows = await sql`
      SELECT property_id FROM sessions_legacy WHERE session_id = ${body.sessionId}
    `;
    if (legacyRows.length) {
      propertyId = legacyRows[0].property_id as string;
    } else {
      return legacyCanvasPost(body.sessionId, body.nodes, body.edges, uid, email);
    }
  }

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });

  const access = await resolvePropertyAccess(propertyId, uid, email);
  if (!access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { nodes, edges } = body;

  // Persist canvas_layouts for all nodes
  for (const n of nodes) {
    const kind = n.type === "photo" ? "asset" : "generation";
    const entityId = (n.data.assetId ?? n.data.generationId ?? n.id) as string;
    await sql`
      INSERT INTO canvas_layouts (property_id, entity_kind, entity_id, x, y)
      VALUES (${propertyId}, ${kind}, ${entityId}, ${n.position.x}, ${n.position.y})
      ON CONFLICT (property_id, entity_kind, entity_id)
        DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y
    `;
  }

  // Sync generation_inputs from edges — only for generation nodes we own
  // We process "base" and "reference" edges; hero edges come from the pipeline.
  const generationIds = nodes.filter(n => n.type === "generation").map(n =>
    (n.data.generationId ?? n.id) as string
  );
  if (generationIds.length > 0) {
    // Delete existing non-hero inputs for these generations then re-insert
    await sql`
      DELETE FROM generation_inputs
      WHERE generation_id = ANY(${generationIds})
        AND role IN ('base', 'reference')
    `;

    const refCount = new Map<string, number>();
    for (const e of edges) {
      if (!generationIds.includes(e.target)) continue;
      const role = e.targetHandle === "base" ? "base" : "reference";
      // Source is either a generation (output handle) or an asset (photo handle)
      // We store the asset_id; if source is a generation we need its output_asset_id
      const sourceGenNode = nodes.find(n => n.id === e.source && n.type === "generation");
      const assetId = sourceGenNode
        ? (sourceGenNode.data.outputAssetId as string | null)
        : e.source; // source is an asset id
      if (!assetId) continue;

      const ord = role === "reference" ? (refCount.get(e.target) ?? 0) : 0;
      if (role === "reference") refCount.set(e.target, ord + 1);

      await sql`
        INSERT INTO generation_inputs (generation_id, asset_id, role, ord)
        VALUES (${e.target}, ${assetId}, ${role}, ${ord})
        ON CONFLICT DO NOTHING
      `;

      // Keep source_asset_id in sync for base edges
      if (role === "base") {
        await sql`
          UPDATE generations SET source_asset_id = ${assetId}
          WHERE id = ${e.target} AND source_asset_id IS DISTINCT FROM ${assetId}
        `;
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Legacy fallbacks — used when the session_id hasn't been migrated yet
// These read/write old canvas_nodes / canvas_edges tables directly.
// ---------------------------------------------------------------------------
async function legacyCanvasGet(
  req: NextRequest,
  sessionId: string,
  uid: string | null,
  email: string | null
): Promise<NextResponse> {
  const access = await resolveAccess(sessionId, uid, email);
  if (!access.canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (access.needsPassword && access.passwordHash) {
    const cookieValue = req.cookies.get(passwordCookieName(sessionId))?.value;
    if (!verifyPasswordCookie(cookieValue, sessionId, access.passwordHash)) {
      return NextResponse.json({ error: "Password required" }, { status: 401 });
    }
  }

  const [nodes, edges] = await Promise.all([
    sql`SELECT id, type, x, y, data FROM canvas_nodes WHERE session_id = ${sessionId} ORDER BY created_at`,
    sql`SELECT id, source, source_handle, target, target_handle FROM canvas_edges WHERE session_id = ${sessionId}`,
  ]);

  return NextResponse.json({ nodes, edges });
}

async function legacyCanvasPost(
  sessionId: string,
  nodes: Array<{ id: string; type: string; position?: { x: number; y: number }; x?: number; y?: number; data: Record<string, unknown> }>,
  edges: Array<{ id: string; source: string; sourceHandle: string; target: string; targetHandle: string }>,
  uid: string | null,
  email: string | null
): Promise<NextResponse> {
  const access = await resolveAccess(sessionId, uid, email);
  if (!access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  for (const n of nodes) {
    const x = n.position?.x ?? n.x ?? 0;
    const y = n.position?.y ?? n.y ?? 0;
    await sql`
      INSERT INTO canvas_nodes (id, session_id, type, x, y, data)
      VALUES (${n.id}, ${sessionId}, ${n.type}, ${x}, ${y}, ${JSON.stringify(n.data)})
      ON CONFLICT (id) DO UPDATE
        SET x = EXCLUDED.x, y = EXCLUDED.y,
            data = canvas_nodes.data || EXCLUDED.data
    `;
  }

  if (nodes.length > 0) {
    const ids = nodes.map(n => n.id);
    await sql`DELETE FROM canvas_nodes WHERE session_id = ${sessionId} AND id != ALL(${ids})`;
  } else {
    await sql`DELETE FROM canvas_nodes WHERE session_id = ${sessionId}`;
  }

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
