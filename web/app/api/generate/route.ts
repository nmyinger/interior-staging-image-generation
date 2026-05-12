import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

const PHOTOS_DIR = path.resolve(process.cwd(), "../Source Photos");
const MODEL_IMAGE = "gemini-3.1-flash-image-preview";

export async function POST(req: NextRequest) {
  const { baseFilename, referenceDataUrl, prompt } = await req.json();

  if (!baseFilename || !prompt) {
    return NextResponse.json({ error: "baseFilename and prompt are required" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  const basePath = path.join(PHOTOS_DIR, baseFilename);
  if (!fs.existsSync(basePath)) {
    return NextResponse.json({ error: `Photo not found: ${baseFilename}` }, { status: 404 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const baseBytes = fs.readFileSync(basePath);
  const baseB64 = baseBytes.toString("base64");

  type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
  const parts: Part[] = [
    { text: prompt },
    { inlineData: { mimeType: "image/jpeg", data: baseB64 } },
  ];

  if (referenceDataUrl) {
    const match = referenceDataUrl.match(/^data:([^;]+);base64,(.+)$/);
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
        const dataUrl = `data:${part.inlineData.mimeType ?? "image/jpeg"};base64,${part.inlineData.data}`;
        return NextResponse.json({ imageDataUrl: dataUrl });
      }
    }
  }

  return NextResponse.json({ error: "Model returned no image" }, { status: 500 });
}
