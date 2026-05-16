import { put } from "@vercel/blob";
import { sql } from "@/lib/db";

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Upload raw bytes (or base64 string) to Vercel Blob.
 * Key format: e.g. "photos/{userId}/{filename}" or "gen/{nodeId}/{ts}.jpg"
 * Returns the public URL.
 */
export async function uploadToBlob(
  key: string,
  data: Buffer | string,
  contentType: string
): Promise<string> {
  if (!isBlobConfigured()) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set — provision Vercel Blob storage first.");
  }
  const buffer = typeof data === "string" ? Buffer.from(data, "base64") : data;
  const { url } = await put(key, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });
  return url;
}

/**
 * Dev fallback: store base64 image inline in asset_inline_data and return
 * a local API URL that serves it back. Use only when Blob is not configured.
 */
export async function storeInlineAsset(
  assetId: string,
  b64: string,
  mimeType: string
): Promise<string> {
  await sql`
    INSERT INTO asset_inline_data (asset_id, mime_type, data_b64)
    VALUES (${assetId}, ${mimeType}, ${b64})
    ON CONFLICT (asset_id) DO UPDATE
      SET data_b64  = EXCLUDED.data_b64,
          mime_type = EXCLUDED.mime_type
  `;
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}/api/assets/${assetId}/inline`;
}
