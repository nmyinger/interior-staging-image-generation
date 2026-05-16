import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";
import { sql, genId } from "@/lib/db";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID, type ModelId } from "@/lib/models";
import { resolveAccess, resolvePropertyAccess } from "@/lib/access";
import { uploadToBlob, isBlobConfigured, storeInlineAsset } from "@/lib/storage";
import { canGenerate, recordGeneration, getSubscription } from "@/lib/billing";
import { getUserOrg } from "@/lib/orgs";
import { z } from "zod";

const PROMPT_MAX_CHARS = 4096;
const MAX_REF_IMAGES = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getUidEmail(session: any) {
  const user = session?.user as { id?: string; email?: string } | undefined;
  return { uid: user?.id ?? null, email: user?.email ?? null };
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image from ${url}: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const mimeType = contentType.split(";")[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType };
}

export async function POST(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  const { uid, email } = getUidEmail(authSession);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const generateSchema = z.object({
    nodeId: z.string().optional(),
    generationId: z.string().optional(),
    sessionId: z.string().optional(),
    prompt: z.string().max(PROMPT_MAX_CHARS),
    model: z.string().optional(),
  });

  const parsed = generateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { prompt, model: requestedModel, sessionId } = parsed.data;
  const nodeId = parsed.data.generationId ?? parsed.data.nodeId;
  if (!nodeId) return NextResponse.json({ error: "nodeId or generationId is required" }, { status: 400 });

  const model = ALLOWED_MODEL_IDS.includes(requestedModel as ModelId)
    ? (requestedModel as string)
    : DEFAULT_MODEL_ID;

  const quota = await canGenerate(uid);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: "quota_exceeded", reason: quota.reason, tier: quota.tier },
      { status: 402 }
    );
  }

  // ─── Resolve billing org ────────────────────────────────────────────────────
  let orgId: string | null = null;
  try {
    const sub = await getSubscription(uid);
    orgId = (sub?.org_id as string) ?? null;
  } catch { /* billing tables not present yet */ }
  if (!orgId) {
    const org = await getUserOrg(uid);
    orgId = org?.id ?? null;
  }
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // ─── Try unified path first ─────────────────────────────────────────────────
  const genRows = await sql`
    SELECT g.id, g.property_id, g.room_id, g.org_id, g.output_asset_id
    FROM generations g
    WHERE g.id = ${nodeId} AND g.parent_generation_id IS NULL
  `;

  if (genRows.length > 0) {
    return handleUnifiedGenerate(
      req, genRows[0] as Record<string, unknown>,
      { uid, email, orgId, periodStart, prompt, model, nodeId }
    );
  }

  // ─── Legacy path: canvas_nodes + canvas_edges ───────────────────────────────
  return handleLegacyGenerate(req, { uid, email, orgId, periodStart, prompt, model, nodeId, sessionId: sessionId ?? null });
}

// ---------------------------------------------------------------------------
// Unified generation path — reads generation_inputs, writes to assets
// ---------------------------------------------------------------------------
async function handleUnifiedGenerate(
  req: NextRequest,
  gen: Record<string, unknown>,
  ctx: {
    uid: string;
    email: string | null;
    orgId: string | null;
    periodStart: Date;
    prompt: string;
    model: string;
    nodeId: string;
  }
): Promise<NextResponse> {
  const { uid, email, orgId, periodStart, prompt, model, nodeId } = ctx;
  const propertyId = gen.property_id as string;
  const genOrgId = (gen.org_id as string | null) ?? orgId;

  const access = await resolvePropertyAccess(propertyId, uid, email);
  if (!access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Load inputs ordered by role then ord
  const inputRows = await sql`
    SELECT gi.asset_id, gi.role, gi.ord, a.blob_url, a.mime_type
    FROM generation_inputs gi
    JOIN assets a ON a.id = gi.asset_id
    WHERE gi.generation_id = ${nodeId}
    ORDER BY gi.role = 'base' DESC, gi.ord ASC
  `;

  const baseInput = inputRows.find(r => r.role === "base");
  if (!baseInput) {
    return NextResponse.json({ error: "No base image connected — draw an edge from a photo node to the base handle" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });

  // Fetch base image
  const { base64: baseB64, mimeType: baseMime } = await fetchImageAsBase64(
    baseInput.blob_url as string
  );

  type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
  const parts: Part[] = [
    { text: prompt },
    { inlineData: { mimeType: baseMime, data: baseB64 } },
  ];

  // Fetch reference images
  const refInputs = inputRows.filter(r => r.role === "reference").slice(0, MAX_REF_IMAGES);
  for (const ref of refInputs) {
    try {
      const { base64, mimeType } = await fetchImageAsBase64(ref.blob_url as string);
      parts.push({ inlineData: { mimeType, data: base64 } });
    } catch { /* skip failed refs */ }
  }

  // Update generation status
  await sql`
    UPDATE generations SET status = 'running', started_at = NOW(), prompt = ${prompt}, model = ${model}
    WHERE id = ${nodeId}
  `;

  const ai = new GoogleGenAI({ apiKey });

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
        await sql`UPDATE generations SET status = 'failed', error = 'No candidates returned', finished_at = NOW() WHERE id = ${nodeId}`;
        return NextResponse.json({ error: "No candidates returned" }, { status: 500 });
      }

      for (const part of candidates[0].content?.parts ?? []) {
        if (part.inlineData?.data) {
          const outputB64 = part.inlineData.data;
          const outputMime = part.inlineData.mimeType ?? "image/jpeg";

          // Create output asset
          const assetId = genId();
          let blobUrl: string;
          if (isBlobConfigured()) {
            blobUrl = await uploadToBlob(`gen/${nodeId}/${Date.now()}.jpg`, outputB64, outputMime);
            await sql`
              INSERT INTO assets (id, org_id, property_id, room_id, kind, mime_type, blob_url, uploaded_by)
              VALUES (
                ${assetId},
                ${genOrgId ?? ""},
                ${propertyId},
                ${gen.room_id as string | null},
                'staged',
                ${outputMime},
                ${blobUrl},
                ${uid}
              )
            `;
          } else {
            blobUrl = await storeInlineAsset(assetId, outputB64, outputMime);
            // Insert asset with placeholder blob_url (replaced by inline URL)
            await sql`
              INSERT INTO assets (id, org_id, property_id, room_id, kind, mime_type, blob_url, uploaded_by)
              VALUES (
                ${assetId},
                ${genOrgId ?? ""},
                ${propertyId},
                ${gen.room_id as string | null},
                'staged',
                ${outputMime},
                ${blobUrl},
                ${uid}
              )
            `;
          }

          // Update generation with new output
          await sql`
            UPDATE generations
            SET status = 'done', output_asset_id = ${assetId}, finished_at = NOW()
            WHERE id = ${nodeId}
          `;

          recordGeneration({ orgId, userId: uid, model, refId: nodeId, periodStart })
            .catch(err => console.warn("[generate] recordGeneration failed", err));

          return NextResponse.json({ imageDataUrl: blobUrl });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate/unified] Gemini error:", message);
    await sql`UPDATE generations SET status = 'failed', error = ${message}, finished_at = NOW() WHERE id = ${nodeId}`;
    return NextResponse.json({ error: `Gemini API error: ${message}` }, { status: 500 });
  }

  await sql`UPDATE generations SET status = 'failed', error = 'Model returned no image', finished_at = NOW() WHERE id = ${nodeId}`;
  return NextResponse.json({ error: "Model returned no image" }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Legacy generation path — reads canvas_nodes + canvas_edges
// ---------------------------------------------------------------------------
async function handleLegacyGenerate(
  _req: NextRequest,
  ctx: {
    uid: string;
    email: string | null;
    orgId: string | null;
    periodStart: Date;
    prompt: string;
    model: string;
    nodeId: string;
    sessionId: string | null;
  }
): Promise<NextResponse> {
  const { uid, email, orgId, periodStart, prompt, model, nodeId } = ctx;

  const nodeRows = await sql`
    SELECT session_id FROM canvas_nodes WHERE id = ${nodeId} AND type = 'generation'
  `;
  if (!nodeRows.length) {
    return NextResponse.json({ error: "Generation node not found" }, { status: 404 });
  }
  const sessionId = nodeRows[0].session_id as string;

  const access = await resolveAccess(sessionId, uid, email);
  if (!access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Read previous output for history
  const nodeDataRows = await sql`
    SELECT data->>'outputUrl' AS output_url, data->>'outputB64' AS output_b64
    FROM canvas_nodes WHERE id = ${nodeId}
  `;
  const previousOutputUrl = (nodeDataRows[0]?.output_url as string | null) ?? null;
  const previousOutputB64 = (nodeDataRows[0]?.output_b64 as string | null) ?? null;

  const baseEdges = await sql`
    SELECT source FROM canvas_edges
    WHERE session_id = ${sessionId} AND target = ${nodeId} AND target_handle = 'base'
  `;
  if (!baseEdges.length) {
    return NextResponse.json({ error: "No source photo connected — draw an edge from a photo node to the base handle" }, { status: 400 });
  }

  const baseNodeRows = await sql`
    SELECT type, data FROM canvas_nodes
    WHERE id = ${baseEdges[0].source as string} AND session_id = ${sessionId}
  `;
  if (!baseNodeRows.length) return NextResponse.json({ error: "Base node not found" }, { status: 404 });

  const baseNode = baseNodeRows[0] as { type: string; data: Record<string, unknown> };
  let baseB64: string;
  let baseMime: string;

  if (baseNode.type === "photo") {
    const baseFilename = (baseNode.data as { filename: string }).filename;
    const photoRows = await sql`SELECT image_url, image_b64, mime_type FROM photos WHERE filename = ${baseFilename}`;
    if (!photoRows.length) return NextResponse.json({ error: `Photo asset not found: ${baseFilename}` }, { status: 404 });
    const { image_url, image_b64, mime_type } = photoRows[0] as { image_url: string | null; image_b64: string | null; mime_type: string };
    baseMime = mime_type;
    if (image_url) {
      const { base64 } = await fetchImageAsBase64(image_url);
      baseB64 = base64;
    } else if (image_b64) {
      baseB64 = image_b64;
    } else {
      return NextResponse.json({ error: `Photo asset has no image data: ${baseFilename}` }, { status: 404 });
    }
  } else if (baseNode.type === "generation") {
    const outputUrl = (baseNode.data as { outputUrl?: string }).outputUrl;
    const outputB64 = (baseNode.data as { outputB64?: string }).outputB64;
    if (outputUrl) {
      const { base64 } = await fetchImageAsBase64(outputUrl);
      baseB64 = base64;
      baseMime = "image/jpeg";
    } else if (outputB64) {
      baseB64 = outputB64;
      baseMime = "image/jpeg";
    } else {
      return NextResponse.json({ error: "Connected generation node has no output yet" }, { status: 400 });
    }
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

  const refRows = await sql`
    SELECT n.type, n.data, p.image_url AS photo_url, p.image_b64, p.mime_type
    FROM canvas_edges e
    JOIN canvas_nodes n ON n.id = e.source AND n.session_id = ${sessionId}
    LEFT JOIN photos p ON n.type = 'photo' AND p.filename = (n.data->>'filename')
    WHERE e.session_id = ${sessionId} AND e.target = ${nodeId} AND e.target_handle = 'ref'
    LIMIT ${MAX_REF_IMAGES}
  `;

  for (const ref of refRows) {
    const refData = ref.data as Record<string, unknown>;
    if (ref.type === "photo") {
      if (ref.photo_url) {
        try {
          const { base64 } = await fetchImageAsBase64(ref.photo_url as string);
          parts.push({ inlineData: { mimeType: ref.mime_type as string, data: base64 } });
        } catch { /* skip */ }
      } else if (ref.image_b64) {
        parts.push({ inlineData: { mimeType: ref.mime_type as string, data: ref.image_b64 as string } });
      }
    } else if (ref.type === "generation") {
      const refOutputUrl = refData.outputUrl as string | undefined;
      const refOutputB64 = refData.outputB64 as string | undefined;
      if (refOutputUrl) {
        try {
          const { base64 } = await fetchImageAsBase64(refOutputUrl);
          parts.push({ inlineData: { mimeType: "image/jpeg", data: base64 } });
        } catch { /* skip */ }
      } else if (refOutputB64) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: refOutputB64 } });
      }
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

          if (previousOutputUrl || previousOutputB64) {
            await sql`
              INSERT INTO generation_history (id, node_id, session_id, output_url, output_b64, created_at)
              VALUES (${genId()}, ${nodeId}, ${sessionId}, ${previousOutputUrl ?? null}, ${previousOutputB64 ?? ''}, NOW())
            `;
          }

          let outputImageUrl: string;
          if (isBlobConfigured()) {
            const blobKey = `gen/${nodeId}/${Date.now()}.jpg`;
            const blobUrl = await uploadToBlob(blobKey, outputB64, outputMime);
            await sql`
              UPDATE canvas_nodes
              SET data = data || jsonb_build_object('outputUrl', ${blobUrl}::text, 'status', 'done', 'prompt', ${prompt}::text)
              WHERE id = ${nodeId} AND session_id = ${sessionId}
            `;
            outputImageUrl = blobUrl;
          } else {
            await sql`
              UPDATE canvas_nodes
              SET data = data || jsonb_build_object('outputB64', ${outputB64}::text, 'status', 'done', 'prompt', ${prompt}::text)
              WHERE id = ${nodeId} AND session_id = ${sessionId}
            `;
            outputImageUrl = `data:${outputMime};base64,${outputB64}`;
          }

          recordGeneration({ orgId, userId: uid, model, refId: nodeId, periodStart })
            .catch(err => console.warn("[generate] recordGeneration failed", err));

          return NextResponse.json({ imageDataUrl: outputImageUrl });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate/legacy] Gemini API error:", message);
    return NextResponse.json({ error: `Gemini API error: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ error: "Model returned no image" }, { status: 500 });
}
