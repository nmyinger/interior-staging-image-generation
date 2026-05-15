import { sql, genId } from "@/lib/db";

export interface Org {
  id: string;
  name: string;
  type: string;
  slug: string;
  parent_org_id: string | null;
  brand: Record<string, unknown>;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface SubAccount extends Org {
  property_count: number;
  member_count: number;
}

/**
 * Get the active org for a user (prefers default_org_id, falls back to first
 * active org_members row ordered by created_at).
 */
export async function getUserOrg(userId: string): Promise<Org | null> {
  // Prefer the user's default_org_id
  const userRows = (await sql`
    SELECT default_org_id FROM users WHERE id = ${userId}
  `) as { default_org_id: string | null }[];

  const defaultOrgId = userRows[0]?.default_org_id ?? null;

  if (defaultOrgId) {
    const rows = (await sql`
      SELECT id, name, type, slug, parent_org_id, brand, settings, created_at
      FROM orgs
      WHERE id = ${defaultOrgId}
      LIMIT 1
    `) as Org[];
    if (rows[0]) return rows[0];
  }

  // Fall back to first active org_members row
  const rows = (await sql`
    SELECT o.id, o.name, o.type, o.slug, o.parent_org_id, o.brand, o.settings, o.created_at
    FROM orgs o
    JOIN org_members om ON om.org_id = o.id
    WHERE om.user_id = ${userId} AND om.status = 'active'
    ORDER BY om.created_at ASC
    LIMIT 1
  `) as Org[];

  return rows[0] ?? null;
}

/**
 * Create a child org (client workspace) under a parent org.
 * If clientEmail is provided, an org_members row is created for that email
 * (matched by email on login — no immediate invite needed).
 */
export async function createSubAccount(params: {
  parentOrgId: string;
  name: string;
  clientEmail?: string;
}): Promise<{ org: Org; inviteCode?: string }> {
  const { parentOrgId, name, clientEmail } = params;

  const id = genId();
  // Generate a URL-safe slug from name + id suffix to ensure uniqueness
  const slugBase = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const slug = `${slugBase}-${id.slice(0, 6)}`;

  const orgRows = (await sql`
    INSERT INTO orgs (id, type, name, slug, parent_org_id)
    VALUES (${id}, 'solo', ${name}, ${slug}, ${parentOrgId})
    RETURNING id, name, type, slug, parent_org_id, brand, settings, created_at
  `) as Org[];

  const org = orgRows[0];

  if (clientEmail) {
    // Look up user by email (may not exist yet — they'll match on login)
    const userRows = (await sql`
      SELECT id FROM users WHERE email = ${clientEmail.toLowerCase()} LIMIT 1
    `) as { id: string }[];

    if (userRows[0]) {
      const memberId = genId();
      await sql`
        INSERT INTO org_members (id, org_id, user_id, role, status)
        VALUES (${memberId}, ${org.id}, ${userRows[0].id}, 'owner', 'active')
        ON CONFLICT (org_id, user_id) DO NOTHING
      `;
    }
    // If user doesn't exist yet, the email is stored on the org settings so
    // the auth callback can wire it up later.
    await sql`
      UPDATE orgs
      SET settings = settings || ${JSON.stringify({ pending_client_email: clientEmail.toLowerCase() })}::jsonb
      WHERE id = ${org.id}
    `;
  }

  return { org };
}

/**
 * List child orgs of a parent org, with property + member counts.
 */
export async function listSubAccounts(parentOrgId: string): Promise<SubAccount[]> {
  const rows = (await sql`
    SELECT
      o.id,
      o.name,
      o.type,
      o.slug,
      o.parent_org_id,
      o.brand,
      o.settings,
      o.created_at,
      COUNT(DISTINCT p.id)::int   AS property_count,
      COUNT(DISTINCT om.id)::int  AS member_count
    FROM orgs o
    LEFT JOIN properties p  ON p.org_id = o.id
    LEFT JOIN org_members om ON om.org_id = o.id AND om.status = 'active'
    WHERE o.parent_org_id = ${parentOrgId}
    GROUP BY o.id
    ORDER BY o.created_at ASC
  `) as SubAccount[];

  return rows;
}
