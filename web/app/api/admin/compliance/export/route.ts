import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";
import { EoReport, type EoReportDisclosure } from "@/lib/pdf/eo-report";
import React from "react";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types matching the SQL result shape
// ---------------------------------------------------------------------------

interface DisclosureQueryRow {
  id: string;
  short_code: string;
  original_url: string;
  staged_url: string;
  mls: string | null;
  disclosure_text: string | null;
  created_at: string;
  revoked_at: string | null;
  property_name: string | null;
  property_address: string | null;
  requires_original_url: boolean | null;
  mls_watermark: unknown;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // 1. Require authenticated session
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const uid = (session.user as { id?: string }).id ?? "";
  if (!uid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Parse query params: ?period=90 (days) or ?period=all
  const { searchParams } = new URL(req.url);
  const periodParam = searchParams.get("period") ?? "90";
  const periodDays =
    periodParam === "all" || isNaN(Number(periodParam))
      ? null
      : Number(periodParam);

  const periodLabel =
    periodDays === null ? "All time" : `Last ${periodDays} days`;

  // 3. Resolve the user's org
  const orgRows = (await sql`
    SELECT o.id, o.name
    FROM orgs o
    JOIN org_members om ON om.org_id = o.id
    WHERE om.user_id = ${uid} AND om.status = 'active'
    ORDER BY om.created_at ASC
    LIMIT 1
  `) as { id: string; name: string }[];

  const org = orgRows[0] ?? null;
  if (!org) {
    return new Response(
      JSON.stringify({ error: "No organization found for this account." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // 4. Query disclosures with LEFT JOIN on properties and mls_rules
  const rows = (await sql`
    SELECT
      d.id,
      d.short_code,
      d.original_url,
      d.staged_url,
      d.mls,
      d.disclosure_text,
      d.created_at,
      d.revoked_at,
      p.name   AS property_name,
      p.address AS property_address,
      mr.requires_original_url,
      mr.watermark AS mls_watermark
    FROM disclosures d
    LEFT JOIN properties p  ON p.id  = d.property_id
    LEFT JOIN mls_rules  mr ON mr.code = d.mls
    WHERE d.org_id = ${org.id}
      AND (
        ${periodDays}::int IS NULL
        OR d.created_at > NOW() - (${periodDays !== null ? String(periodDays) : "0"} || ' days')::interval
      )
    ORDER BY d.created_at DESC
  `) as DisclosureQueryRow[];

  // 5. Shape rows into EoReportDisclosure[]
  const disclosures: EoReportDisclosure[] = rows.map((row) => ({
    id: row.id,
    short_code: row.short_code,
    original_url: row.original_url,
    staged_url: row.staged_url,
    mls: row.mls,
    disclosure_text: row.disclosure_text,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    property_name: row.property_name,
    property_address: row.property_address,
    mls_rule:
      row.requires_original_url !== null
        ? {
            requires_original_url: row.requires_original_url ?? false,
            watermark: row.mls_watermark,
          }
        : null,
  }));

  // 6. Render PDF to buffer
  const doc = React.createElement(EoReport, {
    orgName: org.name,
    generatedAt: new Date().toISOString(),
    periodLabel,
    disclosures,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as React.ReactElement<any>;

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderToBuffer(doc);
  } catch (err) {
    console.error("[compliance/export] PDF render error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to generate PDF." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 7. Return the PDF
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `eo-compliance-${dateStr}.pdf`;

  return new Response(new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
