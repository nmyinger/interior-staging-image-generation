import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { isBlobConfigured } from "@/lib/storage";

function getUserId(session: unknown): string | undefined {
  return (session as { user?: { id?: string } } | null)?.user?.id;
}

// GET /api/photos/upload-token?filename={filename}
// Returns a short-lived Vercel Blob client token so the browser can upload directly.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getUserId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isBlobConfigured()) {
    return NextResponse.json(
      { error: "Blob storage is not configured on this server" },
      { status: 503 }
    );
  }

  const filename = req.nextUrl.searchParams.get("filename");
  if (!filename) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }

  const pathname = `photos/${uid}/${filename}`;

  const clientToken = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN!,
    pathname,
    allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"],
    addRandomSuffix: false,
    validUntil: Date.now() + 5 * 60 * 1000, // 5 minutes
  });

  return NextResponse.json({ token: clientToken, pathname });
}
