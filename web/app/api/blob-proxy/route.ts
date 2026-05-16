import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sharp from "sharp";

// Prevent SSRF: only proxy Vercel Blob public storage URLs
const VERCEL_BLOB_HOST = /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/;

function userId(session: unknown) {
  return (session as { user?: { id?: string } } | null)?.user?.id;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!userId(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");
  const w = req.nextUrl.searchParams.get("w");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!VERCEL_BLOB_HOST.test(parsed.hostname)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const width = w ? Math.min(parseInt(w, 10), 1200) : null;

  const blobRes = await fetch(url);
  if (!blobRes.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const raw = Buffer.from(await blobRes.arrayBuffer());

  const resized = width
    ? Buffer.from(await sharp(raw).resize({ width, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer())
    : raw;

  return new NextResponse(resized, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
