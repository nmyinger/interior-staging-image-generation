import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { sql, genId } from "@/lib/db";
import { nanoid } from "nanoid";
import { z } from "zod";

// GET /api/v1/webhooks — list webhook endpoints for the org
export async function GET(req: NextRequest) {
  return withApiAuth(req, async (orgId) => {
    try {
      type EndpointRow = {
        id: string;
        url: string;
        events: string[];
        created_at: string;
      };

      const endpoints = (await sql`
        SELECT id, url, events, created_at
        FROM webhook_endpoints
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
      `) as EndpointRow[];

      return NextResponse.json({ endpoints });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[GET /api/v1/webhooks]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

// POST /api/v1/webhooks — register a new webhook endpoint
export async function POST(req: NextRequest) {
  return withApiAuth(req, async (orgId) => {
    const bodySchema = z.object({
      url: z.string().url(),
      events: z.array(z.string()).min(1),
    });

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { url, events } = parsed.data;

    try {
      const secret = nanoid(32);
      const id = genId();

      await sql`
        INSERT INTO webhook_endpoints (id, org_id, url, secret, events)
        VALUES (${id}, ${orgId}, ${url}, ${secret}, ${events})
      `;

      return NextResponse.json({ id, url, events, secret }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[POST /api/v1/webhooks]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
