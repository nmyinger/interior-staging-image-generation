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

  // Blob-stored photo: redirect directly (browser/CDN caches it)
  if (image_url) {
    const w = req.nextUrl.searchParams.get("w");
    const redirectUrl = w ? `${image_url}?width=${Math.min(parseInt(w, 10), 1200)}` : image_url;
    return NextResponse.redirect(redirectUrl, { status: 302 });
  }

  // Legacy base64 fallback
  if (!image_b64) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let buffer = Buffer.from(image_b64, "base64");
  const w = req.nextUrl.searchParams.get("w");
  if (w) {
    const width = Math.min(parseInt(w, 10), 1200);
    if (width > 0) {
      buffer = Buffer.from(await sharp(buffer).resize({ width, withoutEnlargement: true }).toBuffer());
    }
  }

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime_type,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
