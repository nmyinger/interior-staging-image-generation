import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { sql, genId } from "@/lib/db";
import { uploadToBlob, isBlobConfigured } from "@/lib/storage";
import { z } from "zod";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB base64-encoded

// POST /api/v1/properties/[id]/photos — upload a photo and link to property
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(req, async (orgId, keyId) => {
    try {
      const { id: propertyId } = await params;

      // Verify property belongs to this org
      const propRows = await sql`
        SELECT id FROM properties WHERE id = ${propertyId} AND org_id = ${orgId}
      `;
      if (!propRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const bodySchema = z.object({
        filename: z.string().min(1),
        content_type: z.string().min(1),
        b64: z.string().min(1),
      });

      const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
      }
      const { filename, content_type: mimeType, b64 } = parsed.data;

      if (b64.length > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
      }

      // Resolve user_id from the API key for photo ownership tracking
      const keyRows = await sql`SELECT user_id FROM api_keys WHERE id = ${keyId}`;
      const userId = (keyRows[0]?.user_id as string | null) ?? "";

      // Unique filename scoped to org to avoid collisions
      const uniqueFilename = `${orgId}_${filename}`;

      // Check if this photo already exists (idempotent)
      const existing = await sql`
        SELECT filename, image_url FROM photos WHERE filename = ${uniqueFilename}
      `;

      let imageUrl: string;
      let photoFilename: string;

      if (existing.length > 0) {
        imageUrl = (existing[0].image_url as string | null) ?? "";
        photoFilename = existing[0].filename as string;
      } else {
        if (isBlobConfigured()) {
          imageUrl = await uploadToBlob(`photos/${orgId}/${filename}`, b64, mimeType);
          await sql`
            INSERT INTO photos (filename, user_id, org_id, room_type, zone, default_prompt, image_url, mime_type)
            VALUES (${uniqueFilename}, ${userId}, ${orgId}, 'unknown', 'unknown', '', ${imageUrl}, ${mimeType})
            ON CONFLICT (filename) DO UPDATE SET image_url = EXCLUDED.image_url
          `;
        } else {
          imageUrl = `data:${mimeType};base64,${b64}`;
          await sql`
            INSERT INTO photos (filename, user_id, org_id, room_type, zone, default_prompt, image_b64, mime_type)
            VALUES (${uniqueFilename}, ${userId}, ${orgId}, 'unknown', 'unknown', '', ${b64}, ${mimeType})
            ON CONFLICT (filename) DO NOTHING
          `;
        }
        photoFilename = uniqueFilename;
      }

      // Determine position in property (append to end)
      const countRows = await sql`
        SELECT COUNT(*) AS cnt FROM property_photos WHERE property_id = ${propertyId}
      `;
      const position = Number((countRows[0] as { cnt: unknown })?.cnt ?? 0);

      // Link photo to property
      const photoId = genId();
      await sql`
        INSERT INTO property_photos (id, property_id, photo_filename, room_type, zone, is_hero, position)
        VALUES (${photoId}, ${propertyId}, ${photoFilename}, 'unknown', 'unknown', false, ${position})
        ON CONFLICT DO NOTHING
      `;

      // Return the property_photos id as photo_id
      const ppRows = await sql`
        SELECT id FROM property_photos WHERE id = ${photoId}
      `;
      const finalPhotoId = (ppRows[0]?.id as string | null) ?? photoId;

      return NextResponse.json({ photo_id: finalPhotoId, url: imageUrl }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[POST /api/v1/properties/[id]/photos]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
