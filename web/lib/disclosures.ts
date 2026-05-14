import { sql } from "./db";
import { nanoid } from "nanoid";

export async function createDisclosure(params: {
  orgId: string;
  propertyId?: string;
  batchItemId?: string;
  originalUrl: string;
  stagedUrl: string;
  mls?: string;
  watermarkConfig: object;
  disclosureText: string;
}): Promise<{ shortCode: string; disclosureId: string }> {
  const shortCode = nanoid(7);
  const id = Math.random().toString(36).slice(2, 14);

  await sql`
    INSERT INTO disclosures (
      id, org_id, property_id, batch_item_id, short_code,
      original_url, staged_url, mls, watermark_config, disclosure_text
    ) VALUES (
      ${id}, ${params.orgId}, ${params.propertyId ?? null}, ${params.batchItemId ?? null},
      ${shortCode}, ${params.originalUrl}, ${params.stagedUrl}, ${params.mls ?? null},
      ${JSON.stringify(params.watermarkConfig)}, ${params.disclosureText}
    )
  `;

  return { shortCode, disclosureId: id };
}

export function getDisclosureUrl(shortCode: string): string {
  return `${process.env.NEXTAUTH_URL}/v/${shortCode}`;
}
