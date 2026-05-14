import { put } from "@vercel/blob";

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
