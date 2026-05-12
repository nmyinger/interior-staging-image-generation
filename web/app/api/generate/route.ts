import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";
import { sql } from "@/lib/db";

const MODEL_IMAGE = "gemini-3.1-flash-image-preview";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userId(session: any) {
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { baseFilename, referenceDataUrl, prompt } = await req.json();

  if (!baseFilename || !prompt) {
    return NextResponse.json({ error: "baseFilename and prompt are required" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  // Load base photo from DB
  const rows = await sql`SELECT image_b64, mime_type FROM photos WHERE filename = ${baseFilename}`;
  if (!rows.length) {
    return NextResponse.json({ error: `Photo not found: ${baseFilename}` }, { status: 404 });
  }
  const { image_b64: baseB64, mime_type: baseMime } = rows[0];

  const ai = new GoogleGenAI({ apiKey });

  type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
  const parts: Part[] = [
    { text: prompt },
    { inlineData: { mimeType: baseMime as string, data: baseB64 as string } },
  ];

  if (referenceDataUrl) {
    const match = (referenceDataUrl as string).match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await ai.models.generateContent({
      model: MODEL_IMAGE,
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

        // Persist output to DB
        await sql`
          INSERT INTO generations (user_id, filename, prompt, output_b64, updated_at)
          VALUES (${uid}, ${baseFilename}, ${prompt}, ${outputB64}, NOW())
          ON CONFLICT (user_id, filename) DO UPDATE
            SET prompt = EXCLUDED.prompt,
                output_b64 = EXCLUDED.output_b64,
                updated_at = NOW()
        `;

        const dataUrl = `data:${outputMime};base64,${outputB64}`;
        return NextResponse.json({ imageDataUrl: dataUrl });
      }
    }
  }

  return NextResponse.json({ error: "Model returned no image" }, { status: 500 });
}
