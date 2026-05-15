"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, migrate } from "@/lib/db";
import { redirect } from "next/navigation";
import ComplianceDashboard from "./ComplianceDashboard";

export interface DisclosureRow {
  id: string;
  short_code: string;
  original_url: string;
  staged_url: string;
  mls: string | null;
  disclosure_text: string;
  created_at: string; // ISO string
  revoked_at: string | null; // ISO string or null
  property_name: string | null;
  property_address: string | null;
}

export default async function CompliancePage() {
  await migrate();
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/");
  }

  const uid = (session.user as { id?: string }).id ?? "";

  // Get the user's org
  const orgRows = (await sql`
    SELECT o.id, o.name
    FROM orgs o
    JOIN org_members om ON om.org_id = o.id
    WHERE om.user_id = ${uid} AND om.status = 'active'
    ORDER BY om.created_at ASC
    LIMIT 1
  `) as { id: string; name: string }[];

  const org = orgRows[0] ?? null;

  let disclosures: DisclosureRow[] = [];

  if (org) {
    const raw = (await sql`
      SELECT
        d.id,
        d.short_code,
        d.original_url,
        d.staged_url,
        d.mls,
        d.disclosure_text,
        d.created_at,
        d.revoked_at,
        p.name AS property_name,
        p.address AS property_address
      FROM disclosures d
      LEFT JOIN properties p ON p.id = d.property_id
      WHERE d.org_id = ${org.id}
      ORDER BY d.created_at DESC
      LIMIT 500
    `) as {
      id: string;
      short_code: string;
      original_url: string;
      staged_url: string;
      mls: string | null;
      disclosure_text: string;
      created_at: Date | string;
      revoked_at: Date | string | null;
      property_name: string | null;
      property_address: string | null;
    }[];

    // Serialize dates to ISO strings so the prop is JSON-safe
    disclosures = raw.map((r) => ({
      ...r,
      created_at:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at),
      revoked_at:
        r.revoked_at instanceof Date
          ? r.revoked_at.toISOString()
          : r.revoked_at
          ? String(r.revoked_at)
          : null,
    }));
  }

  return (
    <ComplianceDashboard
      orgName={org?.name ?? "your organization"}
      initialDisclosures={disclosures}
    />
  );
}
