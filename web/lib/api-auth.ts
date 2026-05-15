import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";

// ---------------------------------------------------------------------------
// Rate limiting (optional — skipped if Upstash env vars are missing)
// ---------------------------------------------------------------------------

let ratelimit: {
  limit: (id: string) => Promise<{ success: boolean }>;
} | null = null;

async function getRatelimiter() {
  if (ratelimit !== null) return ratelimit;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // No Upstash config — disable rate limiting
    ratelimit = { limit: async () => ({ success: true }) };
    return ratelimit;
  }

  try {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");

    const redis = new Redis({ url, token });
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      analytics: false,
    });

    ratelimit = {
      limit: (id: string) => limiter.limit(id),
    };
  } catch {
    // If import fails for any reason, skip rate limiting
    ratelimit = { limit: async () => ({ success: true }) };
  }

  return ratelimit;
}

// ---------------------------------------------------------------------------
// Key hashing
// ---------------------------------------------------------------------------

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

// ---------------------------------------------------------------------------
// resolveApiKey
// ---------------------------------------------------------------------------

export interface ApiKeyResolution {
  valid: boolean;
  orgId?: string;
  keyId?: string;
  error?: string;
}

export async function resolveApiKey(req: NextRequest): Promise<ApiKeyResolution> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or malformed Authorization header" };
  }

  const rawKey = authHeader.slice(7); // strip "Bearer "
  if (!rawKey.startsWith("isk_live_")) {
    return { valid: false, error: "Invalid API key format" };
  }

  // key_prefix is first 12 chars of the nanoid part (after "isk_live_")
  const nanoidPart = rawKey.slice("isk_live_".length);
  const keyPrefix = nanoidPart.slice(0, 12);

  // Rate limit per key prefix before hitting the DB
  const limiter = await getRatelimiter();
  const { success: allowed } = await limiter.limit(`apikey:${keyPrefix}`);
  if (!allowed) {
    return { valid: false, error: "Rate limit exceeded" };
  }

  // Lookup by prefix (index on key_prefix WHERE revoked_at IS NULL)
  type KeyRow = { id: string; org_id: string; key_hash: string };
  const rows = (await sql`
    SELECT id, org_id, key_hash
    FROM api_keys
    WHERE key_prefix = ${keyPrefix} AND revoked_at IS NULL
  `) as KeyRow[];

  if (!rows.length) {
    return { valid: false, error: "Invalid API key" };
  }

  // Constant-time comparison against stored hash
  const incomingHash = hashApiKey(rawKey);
  const incomingBuf = Buffer.from(incomingHash, "hex");

  let matched: KeyRow | null = null;
  for (const row of rows) {
    const storedBuf = Buffer.from(row.key_hash, "hex");
    if (
      incomingBuf.byteLength === storedBuf.byteLength &&
      timingSafeEqual(incomingBuf, storedBuf)
    ) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    return { valid: false, error: "Invalid API key" };
  }

  // Update last_used_at (fire-and-forget)
  sql`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${matched.id}`.catch(() => {});

  return { valid: true, orgId: matched.org_id, keyId: matched.id };
}

// ---------------------------------------------------------------------------
// withApiAuth helper
// ---------------------------------------------------------------------------

export async function withApiAuth(
  req: NextRequest,
  handler: (orgId: string, keyId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  const resolution = await resolveApiKey(req);

  if (!resolution.valid) {
    if (resolution.error === "Rate limit exceeded") {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return handler(resolution.orgId!, resolution.keyId!);
}
