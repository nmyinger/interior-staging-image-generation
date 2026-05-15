import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { sql, genId } from "@/lib/db";
import { z } from "zod";

// GET /api/v1/properties — list properties for the org
export async function GET(req: NextRequest) {
  return withApiAuth(req, async (orgId) => {
    try {
      type PropertyRow = {
        id: string;
        name: string;
        address: string | null;
        mls: string | null;
        status: string;
        created_at: string;
      };

      const properties = (await sql`
        SELECT id, name, address, mls, status, created_at
        FROM properties
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
      `) as PropertyRow[];

      return NextResponse.json({ properties });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[GET /api/v1/properties]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

// POST /api/v1/properties — create a property
export async function POST(req: NextRequest) {
  return withApiAuth(req, async (orgId, keyId) => {
    const bodySchema = z.object({
      name: z.string().min(1),
      address: z.string().optional(),
      mls: z.string().optional(),
      style_brief: z.record(z.string(), z.unknown()).optional(),
    });

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { name, address = null, mls = null, style_brief = {} } = parsed.data;

    try {
      // Resolve a user_id for created_by — use the user who owns the key
      const keyRows = await sql`SELECT user_id FROM api_keys WHERE id = ${keyId}`;
      const createdBy = (keyRows[0]?.user_id as string | null) ?? "api";

      const id = genId();
      await sql`
        INSERT INTO properties (id, org_id, created_by, name, address, mls, style_brief, status)
        VALUES (
          ${id},
          ${orgId},
          ${createdBy},
          ${name},
          ${address},
          ${mls},
          ${JSON.stringify(style_brief)},
          'draft'
        )
      `;

      type PropertyRow = {
        id: string;
        name: string;
        address: string | null;
        mls: string | null;
        status: string;
        created_at: string;
      };

      const rows = (await sql`
        SELECT id, name, address, mls, status, created_at
        FROM properties WHERE id = ${id}
      `) as PropertyRow[];

      return NextResponse.json(rows[0], { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[POST /api/v1/properties]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
