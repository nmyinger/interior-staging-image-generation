import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";
import { sql } from "@/lib/db";

// Keep in sync with GENERATION_MODELS in components/canvas/NodeSettingsPanel.tsx
const ALLOWED_MODEL_IDS = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
] as const;

const DEFAULT_MODEL = ALLOWED_MODEL_IDS[0];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nodeId, prompt, model: requestedModel } = await req.json() as { nodeId: string; prompt: string; model?: string };
  const model = ALLOWED_MODEL_IDS.includes(requestedModel as typeof ALLOWED_MODEL_IDS[number])
    ? (requestedModel as string)
    : DEFAULT_MODEL;

  if (!nodeId || !prompt) {
    return NextResponse.json({ error: "nodeId and prompt are required" }, { status: 400 });
  }

  // Verify generation node exists and belongs to an owned session
  const genRows = await sql`
    SELECT n.id, n.session_id
    FROM canvas_nodes n
    JOIN sessions s ON s.id = n.session_id
    WHERE n.id = ${nodeId} AND s.owner_user_id = ${uid} AND n.type = 'generation'
  `;
  if (!genRows.length) {
    return NextResponse.json({ error: "Generation node not found" }, { status: 404 });
  }
  const sessionId = genRows[0].session_id as string;

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
    SELECT data FROM canvas_nodes
    WHERE id = ${baseEdges[0].source as string} AND session_id = ${sessionId} AND type = 'photo'
  `;
  if (!baseNodeRows.length) {
    return NextResponse.json({ error: "Source photo node not found" }, { status: 404 });
  }
  const baseFilename = (baseNodeRows[0].data as { filename: string }).filename;

  const photoRows = await sql`SELECT image_b64, mime_type FROM photos WHERE filename = ${baseFilename}`;
  if (!photoRows.length) {
    return NextResponse.json({ error: `Photo asset not found: ${baseFilename}` }, { status: 404 });
  }
  const { image_b64: baseB64, mime_type: baseMime } = photoRows[0];

  // Resolve optional reference images from ref edges
  const refEdges = await sql`
    SELECT source FROM canvas_edges
    WHERE session_id = ${sessionId} AND target = ${nodeId} AND target_handle = 'ref'
  `;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });

  const ai = new GoogleGenAI({ apiKey });

  type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
  const parts: Part[] = [
    { text: prompt },
    { inlineData: { mimeType: baseMime as string, data: baseB64 as string } },
  ];

  for (const refEdge of refEdges) {
    const refRows = await sql`
      SELECT type, data FROM canvas_nodes WHERE id = ${refEdge.source as string} AND session_id = ${sessionId}
    `;
    if (!refRows.length) continue;
    const ref = refRows[0] as { type: string; data: Record<string, unknown> };

    if (ref.type === "photo") {
      const refPhotoRows = await sql`
        SELECT image_b64, mime_type FROM photos WHERE filename = ${ref.data.filename as string}
      `;
      if (refPhotoRows.length) {
        parts.push({ inlineData: { mimeType: refPhotoRows[0].mime_type as string, data: refPhotoRows[0].image_b64 as string } });
      }
    } else if (ref.type === "generation" && ref.data.outputB64) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: ref.data.outputB64 as string } });
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

          await sql`
            UPDATE canvas_nodes
            SET data = data || jsonb_build_object('outputB64', ${outputB64}, 'status', 'done', 'prompt', ${prompt})
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
