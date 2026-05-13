import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";
import { sql, genId } from "@/lib/db";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID, type ModelId } from "@/lib/models";
import { resolveAccess } from "@/lib/access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getUidEmail(session: any) {
  const user = session?.user as { id?: string; email?: string } | undefined;
  return { uid: user?.id ?? null, email: user?.email ?? null };
}

export async function POST(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  const { uid, email } = getUidEmail(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nodeId, prompt, model: requestedModel } = await req.json() as { nodeId: string; prompt: string; model?: string };
  const model = ALLOWED_MODEL_IDS.includes(requestedModel as ModelId)
    ? (requestedModel as string)
    : DEFAULT_MODEL_ID;

  if (!nodeId || !prompt) {
    return NextResponse.json({ error: "nodeId and prompt are required" }, { status: 400 });
  }

  // Resolve session for this node
  const nodeRows = await sql`
    SELECT session_id FROM canvas_nodes WHERE id = ${nodeId} AND type = 'generation'
  `;
  if (!nodeRows.length) {
    return NextResponse.json({ error: "Generation node not found" }, { status: 404 });
  }
  const sessionId = nodeRows[0].session_id as string;

  const access = await resolveAccess(sessionId, uid, email);
  if (!access.canWrite) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Read current outputB64 before generation so we can push it to history on success
  const nodeDataRows = await sql`
    SELECT data->>'outputB64' AS output_b64 FROM canvas_nodes WHERE id = ${nodeId}
  `;
  const previousOutputB64 = (nodeDataRows[0]?.output_b64 as string | null) ?? null;

  // Resolve base photo from connected edge (server-side, not trusted from client)
  const baseEdges = await sql`
    SELECT source FROM canvas_edges
    WHERE session_id = ${sessionId} AND target = ${nodeId} AND target_handle = 'base'
  `;
  if (!baseEdges.length) {
    return NextResponse.json(
      { error: "No source photo connected — draw an edge from a photo node to the base handle" },
      { status: 400 }
    );
  }

  const baseNodeRows = await sql`
    SELECT type, data FROM canvas_nodes
    WHERE id = ${baseEdges[0].source as string} AND session_id = ${sessionId}
  `;
  if (!baseNodeRows.length) {
    return NextResponse.json({ error: "Base node not found" }, { status: 404 });
  }

  const baseNode = baseNodeRows[0] as { type: string; data: Record<string, unknown> };
  let baseB64: string;
  let baseMime: string;

  if (baseNode.type === "photo") {
    const baseFilename = (baseNode.data as { filename: string }).filename;
    const photoRows = await sql`SELECT image_b64, mime_type FROM photos WHERE filename = ${baseFilename}`;
    if (!photoRows.length) {
      return NextResponse.json({ error: `Photo asset not found: ${baseFilename}` }, { status: 404 });
    }
    baseB64 = photoRows[0].image_b64 as string;
    baseMime = photoRows[0].mime_type as string;
  } else if (baseNode.type === "generation") {
    const outputB64 = (baseNode.data as { outputB64?: string }).outputB64;
    if (!outputB64) {
      return NextResponse.json(
        { error: "Connected generation node has no output yet — generate it first" },
        { status: 400 }
      );
    }
    baseB64 = outputB64;
    baseMime = "image/jpeg";
  } else {
    return NextResponse.json({ error: "Base node must be a photo or generation node" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });

  const ai = new GoogleGenAI({ apiKey });

  type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
  const parts: Part[] = [
    { text: prompt },
    { inlineData: { mimeType: baseMime, data: baseB64 } },
  ];

  // Resolve optional reference images — single JOIN instead of N+1 loop
  const refRows = await sql`
    SELECT n.type, n.data, p.image_b64, p.mime_type
    FROM canvas_edges e
    JOIN canvas_nodes n ON n.id = e.source AND n.session_id = ${sessionId}
    LEFT JOIN photos p ON n.type = 'photo' AND p.filename = (n.data->>'filename')
    WHERE e.session_id = ${sessionId} AND e.target = ${nodeId} AND e.target_handle = 'ref'
  `;
  for (const ref of refRows) {
    const refData = ref.data as Record<string, unknown>;
    if (ref.type === "photo" && ref.image_b64) {
      parts.push({ inlineData: { mimeType: ref.mime_type as string, data: ref.image_b64 as string } });
    } else if (ref.type === "generation" && refData.outputB64) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: refData.outputB64 as string } });
    }
  }

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { responseModalities: ["IMAGE"] },
      });

      const candidates = response.candidates ?? [];
      if (!candidates.length) {
        if (attempt === 0) continue;
        return NextResponse.json({ error: "No candidates returned" }, { status: 500 });
      }

      for (const part of candidates[0].content?.parts ?? []) {
        if (part.inlineData?.data) {
          const outputB64 = part.inlineData.data;
          const outputMime = part.inlineData.mimeType ?? "image/jpeg";

          if (previousOutputB64) {
            await sql`
              INSERT INTO generation_history (id, node_id, session_id, output_b64, created_at)
              VALUES (${genId()}, ${nodeId}, ${sessionId}, ${previousOutputB64}, NOW())
            `;
          }
          await sql`
            UPDATE canvas_nodes
            SET data = data || jsonb_build_object('outputB64', ${outputB64}::text, 'status', 'done', 'prompt', ${prompt}::text)
            WHERE id = ${nodeId} AND session_id = ${sessionId}
          `;

          return NextResponse.json({ imageDataUrl: `data:${outputMime};base64,${outputB64}` });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate] Gemini API error:", message);
    return NextResponse.json({ error: `Gemini API error: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ error: "Model returned no image" }, { status: 500 });
}
