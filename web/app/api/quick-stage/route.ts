import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID, type ModelId } from "@/lib/models";
import { canGenerate, recordGeneration, getSubscription } from "@/lib/billing";
import { getUserOrg } from "@/lib/orgs";
import { z } from "zod";

const schema = z.object({
  baseImage: z.string().min(1),
  referenceImage: z.string().min(1),
  prompt: z.string().max(4096),
  model: z.string().optional(),
});

function extractBase64(str: string): { base64: string; mimeType: string } {
  if (str.startsWith("data:")) {
    const commaIdx = str.indexOf(",");
    const header = str.slice(0, commaIdx);
    const data = str.slice(commaIdx + 1);
    const mimeType = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
    return { base64: data, mimeType };
  }
  return { base64: str, mimeType: "image/jpeg" };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; email?: string } | undefined;
  const uid = user?.id ?? null;
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { baseImage, referenceImage, prompt, model: requestedModel } = parsed.data;
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });

  const { base64: baseB64, mimeType: baseMime } = extractBase64(baseImage);
  const { base64: refB64, mimeType: refMime } = extractBase64(referenceImage);

  const userPrompt = prompt.trim()
    ? `${prompt.trim()}\n\nFurnish the empty room shown in the first image by placing the same furniture, decor style, and arrangement as seen in the second reference image. Preserve the room's original architecture, lighting, and perspective.`
    : "Furnish the empty room shown in the first image by placing the same furniture, decor style, and arrangement as seen in the second reference image. Preserve the room's original architecture, lighting, and perspective.";

  type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

  const parts: Part[] = [
    { text: userPrompt },
    { inlineData: { mimeType: baseMime, data: baseB64 } },
    { inlineData: { mimeType: refMime, data: refB64 } },
  ];

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
        return NextResponse.json({ error: "No candidates returned" }, { status: 500 });
      }

      for (const part of candidates[0].content?.parts ?? []) {
        if (part.inlineData?.data) {
          const outputB64 = part.inlineData.data;
          const outputMime = part.inlineData.mimeType ?? "image/jpeg";

          // Record usage for billing
          let orgId: string | null = null;
          try {
            const sub = await getSubscription(uid);
            orgId = (sub?.org_id as string) ?? null;
          } catch { /* billing tables may not be present */ }
          if (!orgId) {
            const org = await getUserOrg(uid);
            orgId = org?.id ?? null;
          }
          const now = new Date();
          const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

          recordGeneration({ orgId, userId: uid, model, refId: "quick-stage", periodStart })
            .catch((err) => console.warn("[quick-stage] recordGeneration failed", err));

          return NextResponse.json({ imageDataUrl: `data:${outputMime};base64,${outputB64}` });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[quick-stage] Gemini error:", message);
    return NextResponse.json({ error: `Gemini API error: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ error: "Model returned no image" }, { status: 500 });
}
