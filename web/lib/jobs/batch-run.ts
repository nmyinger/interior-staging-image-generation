import { inngest } from "../inngest";
import { sql, genId } from "../db";
import { uploadToBlob, isBlobConfigured, storeInlineAsset } from "../storage";
import { GoogleGenAI } from "@google/genai";
import { DEFAULT_MODEL_ID } from "../models";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ---------------------------------------------------------------------------
// Fetch an image as base64 from a URL (blob URL or local inline URL)
// ---------------------------------------------------------------------------
async function fetchB64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image from ${url}: ${res.status}`);
  const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  return { base64: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType };
}

// ---------------------------------------------------------------------------
// Fetch a photo's base64 from blob_url or property_photos fallback
// ---------------------------------------------------------------------------
async function assetToBase64(asset: Record<string, unknown>): Promise<{ base64: string; mimeType: string }> {
  if (asset.blob_url) return fetchB64(asset.blob_url as string);
  throw new Error(`Asset ${String(asset.id)} has no blob_url`);
}

// Legacy helper for property_photos + photos fallback
async function photoToBase64(photo: {
  image_url?: string | null;
  image_b64?: string | null;
  mime_type?: string | null;
}): Promise<{ base64: string; mimeType: string }> {
  const mimeType = photo.mime_type ?? "image/jpeg";
  if (photo.image_url) {
    const res = await fetch(photo.image_url);
    if (!res.ok) throw new Error(`Failed to fetch photo: ${res.status}`);
    return { base64: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType };
  }
  if (photo.image_b64) return { base64: photo.image_b64, mimeType };
  throw new Error("Photo has no image_url or image_b64");
}

// ---------------------------------------------------------------------------
// Inngest function — handles both unified (assets+generations) and legacy (batch_items)
// ---------------------------------------------------------------------------
export const batchRunFunction = inngest.createFunction(
  {
    id: "batch-run",
    triggers: [{ event: "batch/run" }],
    concurrency: { limit: 4, key: "event.data.batchId" },
    retries: 2,
  },
  async ({
    event,
    step,
  }: {
    event: { data: { batchId: string } };
    step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
  }) => {
    const { batchId } = event.data;

    // -----------------------------------------------------------------------
    // Step 1: Detect mode and load data
    // -----------------------------------------------------------------------
    const { mode, batch, property, generations, legacyPhotos } = await step.run("load", async () => {
      await sql`UPDATE batches SET status = 'analyzing', started_at = NOW() WHERE id = ${batchId}`;

      const [batchRows, propertyRows] = await Promise.all([
        sql`SELECT * FROM batches WHERE id = ${batchId}`,
        sql`
          SELECT p.*
          FROM properties p
          JOIN batches b ON b.property_id = p.id
          WHERE b.id = ${batchId}
        `,
      ]);
      if (!batchRows[0]) throw new Error(`Batch not found: ${batchId}`);

      const batch = batchRows[0] as Record<string, unknown>;
      const property = (propertyRows[0] ?? null) as Record<string, unknown> | null;

      // Check if unified generations exist for this batch
      const genRows = await sql`
        SELECT
          g.id, g.org_id, g.property_id, g.room_id, g.source_asset_id, g.sequence_index, g.status,
          a.blob_url, a.mime_type, a.zone, a.room_type, a.is_hero, a.position
        FROM generations g
        LEFT JOIN assets a ON a.id = g.source_asset_id
        WHERE g.batch_id = ${batchId}
        ORDER BY g.room_id NULLS LAST, g.sequence_index ASC
      `;

      if (genRows.length > 0) {
        return { mode: "unified" as const, batch, property, generations: genRows as Record<string, unknown>[], legacyPhotos: [] };
      }

      // Legacy: load property_photos
      const photoRows = await sql`
        SELECT
          pp.id, pp.property_id, pp.photo_filename, pp.room_type, pp.zone, pp.is_hero, pp.position, pp.room_id,
          ph.image_url, ph.image_b64, ph.mime_type, ph.original_url
        FROM property_photos pp
        JOIN photos ph ON ph.filename = pp.photo_filename
        WHERE pp.property_id = (SELECT property_id FROM batches WHERE id = ${batchId})
        ORDER BY pp.position ASC
      `;

      return { mode: "legacy" as const, batch, property, generations: [], legacyPhotos: photoRows as Record<string, unknown>[] };
    });

    // -----------------------------------------------------------------------
    // Step 2: Generate furniture manifest (common to both paths)
    // -----------------------------------------------------------------------
    const manifest = await step.run("manifest", async () => {
      await sql`UPDATE batches SET status = 'analyzing' WHERE id = ${batchId}`;

      type Part = { inlineData: { data: string; mimeType: string } } | { text: string };

      const sourcePhotos = mode === "unified" ? generations : legacyPhotos;
      const photoParts: Part[] = await Promise.all(
        sourcePhotos.map(async (p) => {
          try {
            const { base64, mimeType } = mode === "unified"
              ? await assetToBase64(p)
              : await photoToBase64(p as Parameters<typeof photoToBase64>[0]);
            return { inlineData: { data: base64, mimeType } } satisfies Part;
          } catch {
            return null;
          }
        })
      ).then(parts => parts.filter(Boolean) as Part[]);

      const styleJson = JSON.stringify((property as { style_brief?: unknown } | null)?.style_brief ?? {});

      const prompt: Part = {
        text: `You are a professional interior staging consultant analyzing ${sourcePhotos.length} photos of a single property.

Return a JSON object with this exact structure (no markdown, no explanation — raw JSON only):
{
  "palette": [{"hex": "#F5F0E8", "role": "primary_wall"}],
  "style": "modern-transitional",
  "zones": {
    "open_plan": {"sofa": {"desc": "linen sectional", "dims": "110\\" W", "material": "linen", "hex": "#D4C5B0"}},
    "bedroom": {"bed": {"desc": "king platform bed", "dims": "76\\" W", "material": "linen", "hex": "#D4C5B0"}},
    "bathroom_suite": {"towels": {"desc": "waffle-weave towels", "material": "cotton", "hex": "#F0EAE0"}}
  }
}
Property style brief: ${styleJson}
Analyze the rooms present and return only the JSON, no other text.`,
      };

      const result = await genai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [...photoParts, prompt] }],
      });

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let manifestData: Record<string, unknown> = {};
      try { manifestData = JSON.parse(jsonMatch?.[0] ?? "{}"); } catch { /* ok */ }

      await sql`UPDATE batches SET manifest = ${JSON.stringify(manifestData)} WHERE id = ${batchId}`;
      return manifestData;
    });

    await sql`UPDATE batches SET status = 'generating' WHERE id = ${batchId}`;

    // -----------------------------------------------------------------------
    // Step 3 (unified): Generate per room, sequentially within each room
    // -----------------------------------------------------------------------
    if (mode === "unified") {
      // Group generations by room_id
      const roomGroups = new Map<string, Record<string, unknown>[]>();
      for (const gen of generations) {
        const key = (gen.room_id as string | null) ?? "__no_room__";
        if (!roomGroups.has(key)) roomGroups.set(key, []);
        roomGroups.get(key)!.push(gen);
      }

      const manifestStr = JSON.stringify(manifest);

      await Promise.all(
        Array.from(roomGroups.entries()).map(async ([roomKey, roomGens]) => {
          let prevOutputB64: string | null = null;

          for (const gen of roomGens) {
            const genId_ = gen.id as string;
            const result = await step.run(`gen-${genId_}`, async () => {
              await sql`
                UPDATE generations SET status = 'running', started_at = NOW()
                WHERE id = ${genId_}
              `;

              try {
                const { base64: sourceB64, mimeType: sourceMime } = await assetToBase64(gen);

                const zone = (gen.zone as string | null) ?? (gen.room_type as string | null) ?? "room";
                const zoneName = zone.replace(/_/g, " ");

                type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

                let prompt: string;
                const parts: Part[] = [];

                if (prevOutputB64) {
                  prompt = `You are staging this empty ${zoneName} room to match the style shown in the reference image.

Furniture specification (use the SAME pieces as the reference):
${manifestStr}

Rules:
- Keep all walls, floors, windows, doors, and architectural elements EXACTLY as they appear in THIS image
- Use the SAME furniture, colors, and style as shown in the reference image
- Professional real estate photography quality, bright and airy`;

                  parts.push(
                    { text: prompt },
                    { inlineData: { mimeType: sourceMime, data: sourceB64 } },
                    { inlineData: { mimeType: "image/jpeg", data: prevOutputB64 } }
                  );
                } else {
                  prompt = `You are staging this empty ${zoneName} room for professional real estate photography.

Furniture specification — use EXACTLY these pieces:
${manifestStr}

Rules:
- Keep all walls, floors, windows, doors, and architectural elements EXACTLY as they appear
- Place the specified furniture with the correct colors, materials, and approximate dimensions
- Add natural window light and correct shadows
- Professional real estate photography quality, bright and airy
- The room is vacant — add only the specified furniture, nothing else`;

                  parts.push(
                    { text: prompt },
                    { inlineData: { mimeType: sourceMime, data: sourceB64 } }
                  );
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
                  throw new Error(`No image generated for generation ${genId_}`);
                }
                const outputB64 = imagePart.inlineData.data;

                // Store output asset
                const assetId = genId();
                const orgId = (gen.org_id as string | null) ?? "";
                const propertyId = (gen.property_id as string | null) ?? "";

                let stagedUrl: string;
                if (isBlobConfigured()) {
                  stagedUrl = await uploadToBlob(`gen/${batchId}/${genId_}/raw.jpg`, outputB64, "image/jpeg");
                  await sql`
                    INSERT INTO assets (id, org_id, property_id, room_id, kind, mime_type, blob_url)
                    VALUES (${assetId}, ${orgId}, ${propertyId}, ${gen.room_id as string | null}, 'staged', 'image/jpeg', ${stagedUrl})
                  `;
                } else {
                  stagedUrl = await storeInlineAsset(assetId, outputB64, "image/jpeg");
                  await sql`
                    INSERT INTO assets (id, org_id, property_id, room_id, kind, mime_type, blob_url)
                    VALUES (${assetId}, ${orgId}, ${propertyId}, ${gen.room_id as string | null}, 'staged', 'image/jpeg', ${stagedUrl})
                  `;
                }

                await sql`
                  UPDATE generations
                  SET status = 'done', output_asset_id = ${assetId}, finished_at = NOW()
                  WHERE id = ${genId_}
                `;

                return { outputB64 };
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await sql`
                  UPDATE generations SET status = 'failed', error = ${message}, finished_at = NOW()
                  WHERE id = ${genId_}
                `;
                throw err;
              }
            });

            prevOutputB64 = result?.outputB64 ?? null;
          }

          void roomKey; // used for grouping only
        })
      );

      await sql`UPDATE batches SET status = 'done', finished_at = NOW() WHERE id = ${batchId}`;
      await sql`UPDATE properties SET status = 'done' WHERE id = (SELECT property_id FROM batches WHERE id = ${batchId})`;
      return { batchId, status: "done", mode: "unified" };
    }

    // -----------------------------------------------------------------------
    // Step 3 (legacy): Zone-based hero + non-hero flow
    // -----------------------------------------------------------------------
    const ZONES = ["open_plan", "bedroom", "bathroom_suite"] as const;
    type Zone = typeof ZONES[number];

    type PhotoRow = Record<string, unknown>;
    const heroByZone: Record<string, { photoId: unknown; stagedUrl: string; base64: string; zone: string } | null> = {};

    await Promise.all(
      ZONES.map(async (zone: Zone) => {
        const zonePhotos = legacyPhotos.filter((p) => p.zone === zone);
        if (zonePhotos.length === 0) { heroByZone[zone] = null; return; }

        const heroPhoto: PhotoRow = zonePhotos.find((p) => p.is_hero) ?? zonePhotos[0];

        heroByZone[zone] = await step.run(`hero-${zone}`, async () => {
          const itemRows = await sql`
            SELECT * FROM batch_items WHERE property_photo_id = ${heroPhoto.id as string} AND batch_id = ${batchId}
          `;
          const item = itemRows[0];
          if (!item) return null;

          await sql`UPDATE batch_items SET status = 'generating', started_at = NOW() WHERE id = ${item.id as string}`;

          let outputB64: string;
          try {
            const { base64, mimeType } = await photoToBase64(heroPhoto as Parameters<typeof photoToBase64>[0]);
            const zoneManifest = (manifest as Record<string, unknown>).zones
              ? ((manifest as Record<string, Record<string, unknown>>).zones[zone] ?? {})
              : {};
            const zoneName = zone.replace(/_/g, " ");
            const prompt = `You are staging this empty ${zoneName} room for professional real estate photography.

Furniture specification — use EXACTLY these pieces:
${JSON.stringify({ palette: (manifest as Record<string, unknown>).palette, style: (manifest as Record<string, unknown>).style, zone: zoneManifest })}

Rules:
- Keep all walls, floors, windows, doors, and architectural elements EXACTLY as they appear
- Place the specified furniture with the correct colors, materials, and approximate dimensions
- Add natural window light and correct shadows
- Professional real estate photography quality, bright and airy
- The room is vacant — add only the specified furniture, nothing else`;

            const response = await genai.models.generateContent({
              model: (batch.model as string | undefined) ?? DEFAULT_MODEL_ID,
              contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
              config: { responseModalities: ["IMAGE"] },
            });

            const imagePart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
            if (!imagePart?.inlineData?.data) throw new Error(`No image generated for hero zone: ${zone}`);
            outputB64 = imagePart.inlineData.data;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await sql`UPDATE batch_items SET status = 'failed', error = ${message}, finished_at = NOW() WHERE id = ${item.id as string}`;
            throw err;
          }

          let stagedUrl: string;
          if (isBlobConfigured()) {
            stagedUrl = await uploadToBlob(`gen/${batchId}/${item.id as string}/raw.jpg`, outputB64, "image/jpeg");
          } else {
            stagedUrl = `data:image/jpeg;base64,${outputB64}`;
          }

          await sql`UPDATE batch_items SET status = 'done', staged_raw_url = ${stagedUrl}, staged_url = ${stagedUrl}, finished_at = NOW() WHERE id = ${item.id as string}`;
          return { photoId: heroPhoto.id, stagedUrl, base64: outputB64, zone };
        });
      })
    );

    const heroPhotoIds = new Set(Object.values(heroByZone).filter(Boolean).map((h) => String(h!.photoId)));
    const nonHeroPhotos = legacyPhotos.filter((p) => !heroPhotoIds.has(String(p.id)));

    await Promise.all(
      nonHeroPhotos.map(async (photo: PhotoRow) => {
        return step.run(`stage-${photo.id as string}`, async () => {
          const itemRows = await sql`SELECT * FROM batch_items WHERE property_photo_id = ${photo.id as string} AND batch_id = ${batchId}`;
          const item = itemRows[0];
          if (!item) return;

          await sql`UPDATE batch_items SET status = 'generating', started_at = NOW() WHERE id = ${item.id as string}`;

          try {
            const { base64: sourceB64, mimeType: sourceMime } = await photoToBase64(photo as Parameters<typeof photoToBase64>[0]);
            const photoZone = photo.zone as string | undefined;
            const hero = photoZone ? heroByZone[photoZone] ?? null : null;

            const zoneManifest = photoZone && (manifest as Record<string, unknown>).zones
              ? ((manifest as Record<string, Record<string, unknown>>).zones[photoZone] ?? {})
              : {};
            const manifestText = JSON.stringify({ palette: (manifest as Record<string, unknown>).palette, style: (manifest as Record<string, unknown>).style, zone: zoneManifest });
            const zoneName = (photoZone ?? "room").replace(/_/g, " ");

            type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
            const prompt = hero?.base64
              ? `You are staging this empty ${zoneName} room to match the style shown in the reference image.\n\nFurniture specification — use the SAME furniture pieces as shown in the reference image:\n${manifestText}\n\nRules:\n- Keep all walls, floors, windows, doors, and architectural elements EXACTLY as they appear in THIS image\n- Use the SAME furniture pieces, colors, and style as shown in the reference image\n- Maintain consistent staging style across all angles of this space\n- Professional real estate photography quality, bright and airy\n- Do not alter room geometry, window sizes, or any structural element`
              : `You are staging this empty ${zoneName} room for professional real estate photography.\n\nFurniture specification — use EXACTLY these pieces:\n${manifestText}\n\nRules:\n- Keep all walls, floors, windows, doors, and architectural elements EXACTLY as they appear\n- Place the specified furniture with the correct colors, materials, and approximate dimensions\n- Add natural window light and correct shadows\n- Professional real estate photography quality, bright and airy`;

            const parts: Part[] = [
              { text: prompt },
              { inlineData: { mimeType: sourceMime, data: sourceB64 } },
              ...(hero?.base64 ? [{ inlineData: { mimeType: "image/jpeg", data: hero.base64 } } satisfies Part] : []),
            ];

            const response = await genai.models.generateContent({
              model: (batch.model as string | undefined) ?? DEFAULT_MODEL_ID,
              contents: [{ role: "user", parts }],
              config: { responseModalities: ["IMAGE"] },
            });

            const imagePart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
            if (!imagePart?.inlineData?.data) throw new Error(`No image generated for photo ${String(photo.id)}`);
            const outputB64 = imagePart.inlineData.data;

            let stagedUrl: string;
            if (isBlobConfigured()) {
              stagedUrl = await uploadToBlob(`gen/${batchId}/${item.id as string}/raw.jpg`, outputB64, "image/jpeg");
            } else {
              stagedUrl = `data:image/jpeg;base64,${outputB64}`;
            }

            await sql`UPDATE batch_items SET status = 'done', staged_raw_url = ${stagedUrl}, staged_url = ${stagedUrl}, finished_at = NOW() WHERE id = ${item.id as string}`;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await sql`UPDATE batch_items SET status = 'failed', error = ${message}, finished_at = NOW() WHERE id = ${item.id as string}`;
            throw err;
          }
        });
      })
    );

    await sql`UPDATE batches SET status = 'done', finished_at = NOW() WHERE id = ${batchId}`;
    return { batchId, status: "done", mode: "legacy" };
  }
);
