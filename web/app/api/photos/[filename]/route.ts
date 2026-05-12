import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PHOTOS_DIR = path.resolve(process.cwd(), "../Source Photos");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const filePath = path.join(PHOTOS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = fs.readFileSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";

  return new NextResponse(data, {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
  });
}
