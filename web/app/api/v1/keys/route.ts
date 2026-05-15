import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";
import { hashApiKey } from "@/lib/api-auth";
import { nanoid } from "nanoid";
import { z } from "zod";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

async function resolveOrgId(uid: string): Promise<string | null> {
  const rows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
  return (rows[0]?.default_org_id as string | null) ?? null;
}

// GET /api/v1/keys — list active API keys for the authenticated user's org
export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const orgId = await resolveOrgId(uid);
    if (!orgId) return NextResponse.json({ keys: [] });

    type KeyRow = {
      id: string;
      name: string;
      key_prefix: string;
      created_at: string;
      last_used_at: string | null;
    };

    const keys = (await sql`
      SELECT id, name, key_prefix, created_at, last_used_at
      FROM api_keys
      WHERE org_id = ${orgId} AND revoked_at IS NULL
      ORDER BY created_at DESC
    `) as KeyRow[];

    return NextResponse.json({ keys });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/v1/keys]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/v1/keys — create a new API key
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bodySchema = z.object({
    name: z.string().min(1).max(100),
  });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { name } = parsed.data;

  try {
    const orgId = await resolveOrgId(uid);
    if (!orgId) {
      return NextResponse.json(
        { error: "User has no organization — create or join an org first" },
        { status: 400 }
      );
    }

    const nanoIdPart = nanoid(32);
    const rawKey = `isk_live_${nanoIdPart}`;
    const keyPrefix = nanoIdPart.slice(0, 12);
    const keyHash = hashApiKey(rawKey);
    const id = genId();

    await sql`
      INSERT INTO api_keys (id, org_id, user_id, name, key_prefix, key_hash)
      VALUES (${id}, ${orgId}, ${uid}, ${name}, ${keyPrefix}, ${keyHash})
    `;

    return NextResponse.json(
      { id, name, key_prefix: keyPrefix, raw_key: rawKey },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/v1/keys]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
