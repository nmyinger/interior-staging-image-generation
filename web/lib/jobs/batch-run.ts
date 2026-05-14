import { inngest } from "../inngest";
import { sql, genId } from "../db";
import { uploadToBlob, isBlobConfigured } from "../storage";
import { GoogleGenAI } from "@google/genai";
import { DEFAULT_MODEL_ID } from "../models";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const ZONES = ["open_plan", "bedroom", "bathroom_suite"] as const;
type Zone = (typeof ZONES)[number];

// ---------------------------------------------------------------------------
// Helper: fetch a photo's base64 from blob URL or inline storage
// ---------------------------------------------------------------------------
async function photoToBase64(photo: {
  image_url?: string | null;
  image_b64?: string | null;
  mime_type?: string | null;
}): Promise<{ base64: string; mimeType: string }> {
  const mimeType = photo.mime_type ?? "image/jpeg";
  if (photo.image_url) {
    const resp = await fetch(photo.image_url);
    if (!resp.ok) throw new Error(`Failed to fetch photo from ${photo.image_url}: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    return { base64: buf.toString("base64"), mimeType };
  }
  if (photo.image_b64) {
    return { base64: photo.image_b64, mimeType };
  }
  throw new Error("Photo has no image_url or image_b64");
}

// ---------------------------------------------------------------------------
// Main Inngest function
// ---------------------------------------------------------------------------
export const batchRunFunction = inngest.createFunction(
  {
    id: "batch-run",
    triggers: [{ event: "batch/run" }],
    concurrency: { limit: 4, key: "event.data.batchId" },
    retries: 2,
  },
  async ({ event, step }: { event: { data: { batchId: string } }; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const { batchId } = event.data;

    // -----------------------------------------------------------------------
    // Step 1: Load batch, property, and all photos
    // -----------------------------------------------------------------------
    const { batch, property, photos } = await step.run("load", async () => {
      await sql`UPDATE batches SET status = 'analyzing', started_at = NOW() WHERE id = ${batchId}`;

      const [batchRows, propertyRows, photoRows] = await Promise.all([
        sql`SELECT * FROM batches WHERE id = ${batchId}`,
        sql`
          SELECT p.*
          FROM properties p
          JOIN batches b ON b.property_id = p.id
          WHERE b.id = ${batchId}
        `,
        sql`
          SELECT
            pp.id,
            pp.property_id,
            pp.photo_filename,
            pp.room_type,
            pp.zone,
            pp.is_hero,
            pp.position,
            ph.image_url,
            ph.image_b64,
            ph.mime_type,
            ph.original_url
          FROM property_photos pp
          JOIN photos ph ON ph.filename = pp.photo_filename
          WHERE pp.property_id = (SELECT property_id FROM batches WHERE id = ${batchId})
          ORDER BY pp.position ASC
        `,
      ]);

      if (!batchRows[0]) throw new Error(`Batch not found: ${batchId}`);

      return {
        batch: batchRows[0] as Record<string, unknown>,
        property: (propertyRows[0] ?? null) as Record<string, unknown> | null,
        photos: photoRows as Record<string, unknown>[],
      };
    });

    // -----------------------------------------------------------------------
    // Step 2: Generate manifest (furniture spec for cross-room consistency)
    // -----------------------------------------------------------------------
    const manifest = await step.run("manifest", async () => {
      await sql`UPDATE batches SET status = 'analyzing' WHERE id = ${batchId}`;

      // Build inline-image parts for every photo in the property
      type InlineDataPart = { inlineData: { data: string; mimeType: string } };
      type TextPart = { text: string };
      type Part = InlineDataPart | TextPart;

      const photoParts: Part[] = await Promise.all(
        photos.map(async (p) => {
          const { base64, mimeType } = await photoToBase64(p as Parameters<typeof photoToBase64>[0]);
          return { inlineData: { data: base64, mimeType } } satisfies InlineDataPart;
        })
      );

      const styleJson = JSON.stringify(
        (property as { style_brief?: unknown } | null)?.style_brief ?? {}
      );

      const prompt: TextPart = {
        text: `You are a professional interior staging consultant analyzing ${photos.length} photos of a single property.

Return a JSON object with this exact structure (no markdown, no explanation — raw JSON only):
{
  "palette": [
    {"hex": "#F5F0E8", "role": "primary_wall"},
    {"hex": "#8B7355", "role": "accent"},
    {"hex": "#E8DDD0", "role": "secondary"}
  ],
  "style": "modern-transitional",
  "zones": {
    "open_plan": {
      "sofa": {"desc": "linen sectional", "dims": "110\\" W x 65\\" D", "material": "linen", "hex": "#D4C5B0"},
      "coffee_table": {"desc": "round travertine", "dims": "42\\" diameter", "material": "travertine", "hex": "#C8B89A"},
      "rug": {"desc": "natural fiber area rug", "dims": "8x10", "material": "jute"}
    },
    "bedroom": {
      "bed": {"desc": "king upholstered platform bed", "dims": "76\\" W x 80\\" L", "material": "linen", "hex": "#D4C5B0"},
      "dresser": {"desc": "walnut 6-drawer dresser", "dims": "60\\" W x 18\\" D", "material": "walnut", "hex": "#7A5C40"},
      "nightstand": {"desc": "marble-top side table", "dims": "22\\" W x 24\\" H", "material": "marble", "hex": "#E8E0D8"}
    },
    "bathroom_suite": {
      "vanity_accessories": {"desc": "white ceramic tray set", "material": "ceramic", "hex": "#FFFFFF"},
      "towels": {"desc": "waffle-weave towels", "material": "cotton", "hex": "#F0EAE0"},
      "plants": {"desc": "small succulent arrangement", "material": "ceramic pot", "hex": "#8A9E6B"}
    }
  }
}

Property style brief: ${styleJson}

Analyze the room types present in the photos and return only the JSON, no other text.`,
      };

      const result = await genai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [...photoParts, prompt] }],
      });

      const text =
        result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let manifestData: Record<string, unknown> = {};
      try {
        manifestData = JSON.parse(jsonMatch?.[0] ?? "{}");
      } catch {
        manifestData = {};
      }

      await sql`UPDATE batches SET manifest = ${JSON.stringify(manifestData)} WHERE id = ${batchId}`;
      return manifestData;
    });

    // -----------------------------------------------------------------------
    // Step 3: Generate hero images — one per zone (run in parallel via steps)
    // -----------------------------------------------------------------------
    await sql`UPDATE batches SET status = 'generating' WHERE id = ${batchId}`;

    // Determine hero photo per zone
    type PhotoRow = Record<string, unknown>;
    const heroByZone: Record<string, { photoId: unknown; stagedUrl: string; base64: string; zone: string } | null> = {};

    await Promise.all(
      ZONES.map(async (zone: Zone) => {
        const zonePhotos = photos.filter((p) => p.zone === zone);
        if (zonePhotos.length === 0) {
          heroByZone[zone] = null;
          return;
        }

        const heroPhoto: PhotoRow =
          zonePhotos.find((p) => p.is_hero) ?? zonePhotos[0];

        heroByZone[zone] = await step.run(`hero-${zone}`, async () => {
          const itemRows = await sql`
            SELECT * FROM batch_items
            WHERE property_photo_id = ${heroPhoto.id as string}
              AND batch_id = ${batchId}
          `;
          const item = itemRows[0];
          if (!item) return null;

          await sql`
            UPDATE batch_items
            SET status = 'generating', started_at = NOW()
            WHERE id = ${item.id as string}
          `;

          let outputB64: string;
          try {
            const { base64, mimeType } = await photoToBase64(heroPhoto as Parameters<typeof photoToBase64>[0]);

            const zoneManifest = (manifest as Record<string, unknown>).zones
              ? ((manifest as Record<string, Record<string, unknown>>).zones[zone] ?? {})
              : {};
            const manifestText = JSON.stringify({
              palette: (manifest as Record<string, unknown>).palette,
              style: (manifest as Record<string, unknown>).style,
              zone: zoneManifest,
            });

            const zoneName = zone.replace(/_/g, " ");
            const prompt = `You are staging this empty ${zoneName} room for professional real estate photography.

Furniture specification — use EXACTLY these pieces:
${manifestText}

Rules:
- Keep all walls, floors, windows, doors, and architectural elements EXACTLY as they appear
- Do not add, remove, or change any structural elements
- Place the specified furniture with the correct colors, materials, and approximate dimensions
- Add natural window light and correct shadows
- Professional real estate photography quality, bright and airy
- The room is vacant — add only the specified furniture, nothing else`;

            const response = await genai.models.generateContent({
              model: (batch.model as string | undefined) ?? DEFAULT_MODEL_ID,
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: prompt },
                    { inlineData: { mimeType, data: base64 } },
                  ],
                },
              ],
              config: { responseModalities: ["IMAGE"] },
            });

            const imagePart = response.candidates?.[0]?.content?.parts?.find(
              (p) => p.inlineData?.data
            );
            if (!imagePart?.inlineData?.data) {
              throw new Error(`No image generated for hero zone: ${zone}`);
            }
            outputB64 = imagePart.inlineData.data;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await sql`
              UPDATE batch_items
              SET status = 'failed', error = ${message}, finished_at = NOW()
              WHERE id = ${item.id as string}
            `;
            throw err;
          }

          let stagedUrl: string;
          if (isBlobConfigured()) {
            stagedUrl = await uploadToBlob(
              `gen/${batchId}/${item.id as string}/raw.jpg`,
              outputB64,
              "image/jpeg"
            );
          } else {
            stagedUrl = `data:image/jpeg;base64,${outputB64}`;
          }

          await sql`
            UPDATE batch_items
            SET status = 'done',
                staged_raw_url = ${stagedUrl},
                staged_url = ${stagedUrl},
                finished_at = NOW()
            WHERE id = ${item.id as string}
          `;

          return {
            photoId: heroPhoto.id,
            stagedUrl,
            base64: outputB64,
            zone,
          };
        });
      })
    );

    // -----------------------------------------------------------------------
    // Step 4: Stage remaining (non-hero) photos using hero as reference
    // -----------------------------------------------------------------------
    const heroPhotoIds = new Set(
      Object.values(heroByZone)
        .filter(Boolean)
        .map((h) => String(h!.photoId))
    );
    const nonHeroPhotos = photos.filter((p) => !heroPhotoIds.has(String(p.id)));

    await Promise.all(
      nonHeroPhotos.map(async (photo: PhotoRow) => {
        return step.run(`stage-${photo.id as string}`, async () => {
          const itemRows = await sql`
            SELECT * FROM batch_items
            WHERE property_photo_id = ${photo.id as string}
              AND batch_id = ${batchId}
          `;
          const item = itemRows[0];
          if (!item) return;

          await sql`
            UPDATE batch_items
            SET status = 'generating', started_at = NOW()
            WHERE id = ${item.id as string}
          `;

          try {
            const { base64: sourceB64, mimeType: sourceMime } = await photoToBase64(
              photo as Parameters<typeof photoToBase64>[0]
            );

            const photoZone = photo.zone as string | undefined;
            const hero = photoZone ? heroByZone[photoZone] ?? null : null;

            const zoneManifest =
              photoZone && (manifest as Record<string, unknown>).zones
                ? ((manifest as Record<string, Record<string, unknown>>).zones[photoZone] ?? {})
                : {};
            const manifestText = JSON.stringify({
              palette: (manifest as Record<string, unknown>).palette,
              style: (manifest as Record<string, unknown>).style,
              zone: zoneManifest,
            });

            const zoneName = (photoZone ?? "room").replace(/_/g, " ");
            const hasHeroRef = hero && hero.base64;

            const prompt = hasHeroRef
              ? `You are staging this empty ${zoneName} room to match the style shown in the reference image.

Furniture specification — use the SAME furniture pieces as shown in the reference image:
${manifestText}

Rules:
- Keep all walls, floors, windows, doors, and architectural elements EXACTLY as they appear in THIS image
- Use the SAME furniture pieces, colors, and style as shown in the reference image
- Maintain consistent staging style across all angles of this space
- Professional real estate photography quality, bright and airy
- Do not alter room geometry, window sizes, or any structural element`
              : `You are staging this empty ${zoneName} room for professional real estate photography.

Furniture specification — use EXACTLY these pieces:
${manifestText}

Rules:
- Keep all walls, floors, windows, doors, and architectural elements EXACTLY as they appear
- Place the specified furniture with the correct colors, materials, and approximate dimensions
- Add natural window light and correct shadows
- Professional real estate photography quality, bright and airy`;

            // Build parts: source photo first, then hero reference if available
            type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
            const parts: Part[] = [
              { text: prompt },
              { inlineData: { mimeType: sourceMime, data: sourceB64 } },
            ];
            if (hasHeroRef) {
              parts.push({ inlineData: { mimeType: "image/jpeg", data: hero!.base64 } });
            }

            const response = await genai.models.generateContent({
              model: (batch.model as string | undefined) ?? DEFAULT_MODEL_ID,
              contents: [{ role: "user", parts }],
              config: { responseModalities: ["IMAGE"] },
            });

            const imagePart = response.candidates?.[0]?.content?.parts?.find(
              (p) => p.inlineData?.data
            );
            if (!imagePart?.inlineData?.data) {
              throw new Error(`No image generated for photo ${String(photo.id)}`);
            }
            const outputB64 = imagePart.inlineData.data;

            let stagedUrl: string;
            if (isBlobConfigured()) {
              stagedUrl = await uploadToBlob(
                `gen/${batchId}/${item.id as string}/raw.jpg`,
                outputB64,
                "image/jpeg"
              );
            } else {
              stagedUrl = `data:image/jpeg;base64,${outputB64}`;
            }

            await sql`
              UPDATE batch_items
              SET status = 'done',
                  staged_raw_url = ${stagedUrl},
                  staged_url = ${stagedUrl},
                  finished_at = NOW()
              WHERE id = ${item.id as string}
            `;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await sql`
              UPDATE batch_items
              SET status = 'failed', error = ${message}, finished_at = NOW()
              WHERE id = ${item.id as string}
            `;
            // Re-throw so Inngest retries the step
            throw err;
          }
        });
      })
    );

    // -----------------------------------------------------------------------
    // Mark batch complete
    // -----------------------------------------------------------------------
    await sql`
      UPDATE batches
      SET status = 'done', finished_at = NOW()
      WHERE id = ${batchId}
    `;

    return { batchId, status: "done" };
  }
);
