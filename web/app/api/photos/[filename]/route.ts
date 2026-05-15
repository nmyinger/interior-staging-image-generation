import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import sharp from "sharp";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as { id?: string } | undefined)?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename } = await params;
  const rows = await sql`
    SELECT image_url, image_b64, mime_type FROM photos WHERE filename = ${filename}
  `;
  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { image_url, image_b64, mime_type } = rows[0] as {
    image_url: string | null;
    image_b64: string | null;
    mime_type: string;
  };

  const w = req.nextUrl.searchParams.get("w");
  const width = w ? Math.min(parseInt(w, 10), 1200) : null;

  // Blob-stored photo: fetch raw bytes, resize with sharp, return with immutable CDN cache.
  // Vercel Blob CDN does not support ?width= transforms — redirecting there delivers full-res.
  if (image_url) {
    if (!width) {
      // No resize requested — pass through to blob directly
      return NextResponse.redirect(image_url, { status: 302 });
    }
    const blobRes = await fetch(image_url);
    if (!blobRes.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const raw = Buffer.from(await blobRes.arrayBuffer());
    const resized = Buffer.from(
      await sharp(raw).resize({ width, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    );
    return new NextResponse(resized, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // Legacy base64 fallback
  if (!image_b64) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let buffer = Buffer.from(image_b64, "base64");
  if (width && width > 0) {
    buffer = Buffer.from(await sharp(buffer).resize({ width, withoutEnlargement: true }).toBuffer());
  }

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime_type,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
