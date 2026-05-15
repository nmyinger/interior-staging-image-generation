import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserOrg } from "@/lib/orgs";
import { sql } from "@/lib/db";
import { z } from "zod";

interface MlsRuleRow {
  code: string;
  display_name: string;
  jurisdiction: string | null;
  watermark: Record<string, unknown>;
  requires_original_url: boolean;
  disclosure_text: string;
}

const patchSchema = z.object({
  activeMls: z.array(z.string()),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uid = (session.user as { id?: string }).id ?? "";
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(uid);
  if (!org) {
    return NextResponse.json(
      { error: "No organization found." },
      { status: 404 }
    );
  }

  const mlsRows = (await sql`
    SELECT code, display_name, jurisdiction, watermark, requires_original_url, disclosure_text
    FROM mls_rules
    ORDER BY code ASC
  `) as MlsRuleRow[];

  return NextResponse.json({
    settings: org.settings ?? {},
    mlsRules: mlsRows,
  });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uid = (session.user as { id?: string }).id ?? "";
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const org = await getUserOrg(uid);
  if (!org) {
    return NextResponse.json(
      { error: "No organization found." },
      { status: 404 }
    );
  }

  const newSettings = JSON.stringify({ activeMls: parsed.data.activeMls });

  await sql`
    UPDATE orgs
    SET settings = settings || ${newSettings}::jsonb
    WHERE id = ${org.id}
  `;

  return NextResponse.json({ ok: true });
}
