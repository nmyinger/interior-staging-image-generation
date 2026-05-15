import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, migrate } from "@/lib/db";
import { redirect } from "next/navigation";

interface OrgRow {
  id: string;
  name: string;
  type: "solo" | "studio" | "brokerage";
  slug: string;
}

interface SubRow {
  tier: string;
  status: string;
}

interface UsageRow {
  count: string;
  total_cost_cents: string;
}

const planLabels: Record<string, string> = {
  solo: "Solo",
  studio: "Studio",
  brokerage: "Brokerage",
};

const typeColors: Record<string, string> = {
  solo: "bg-stone-100 text-stone-600",
  studio: "bg-acacia-100 text-acacia-500",
  brokerage: "bg-sage-100 text-sage-700",
};

const statusColors: Record<string, string> = {
  active: "bg-moss-500/10 text-moss-500",
  trialing: "bg-acacia-100 text-acacia-500",
  canceled: "bg-stone-100 text-stone-500",
  past_due: "bg-clay-400/10 text-clay-500",
};


export default async function AdminPage() {
  await migrate();
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/");
  }

  const uid = (session.user as { id?: string }).id ?? "";

  // Fetch org the user belongs to
  const orgRows = (await sql`
    SELECT o.id, o.name, o.type, o.slug
    FROM orgs o
    JOIN org_members om ON om.org_id = o.id
    WHERE om.user_id = ${uid} AND om.status = 'active'
    ORDER BY om.created_at ASC
    LIMIT 1
  `) as OrgRow[];

  const org = orgRows[0] ?? null;

  let sub: SubRow | null = null;
  let usage: UsageRow | null = null;

  if (org) {
    const subRows = (await sql`
      SELECT tier, status FROM billing_subscriptions WHERE org_id = ${org.id} LIMIT 1
    `) as SubRow[];
    sub = subRows[0] ?? null;

    // Usage this billing period
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const usageRows = (await sql`
      SELECT COUNT(*) AS count, COALESCE(SUM(cost_cents), 0) AS total_cost_cents
      FROM usage_events
      WHERE org_id = ${org.id} AND billing_period_start >= ${periodStart}
    `) as UsageRow[];
    usage = usageRows[0] ?? null;
  }

  const userName = session.user.name ?? session.user.email ?? "there";

  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {/* Org header */}
        <div>
          <p className="text-xs text-stone-400 mb-1">Welcome back, {userName.split(" ")[0]}</p>
          {org ? (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-stone-800">{org.name}</h1>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${typeColors[org.type] ?? "bg-stone-100 text-stone-600"}`}
              >
                {org.type}
              </span>
              {sub && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusColors[sub.status] ?? "bg-stone-100 text-stone-600"}`}
                >
                  {planLabels[sub.tier] ?? sub.tier} plan
                </span>
              )}
            </div>
          ) : (
            <h1 className="text-2xl font-bold text-stone-800">My Account</h1>
          )}
        </div>

        {/* Usage strip */}
        {usage && org && (
          <div className="bg-white border border-stone-200 rounded-xl px-6 py-4 flex items-center gap-8">
            <div>
              <p className="text-xs text-stone-400 mb-0.5">Generations this month</p>
              <p className="text-2xl font-bold text-stone-800">{usage.count}</p>
            </div>
            <div className="w-px h-8 bg-stone-200" />
            <div>
              <p className="text-xs text-stone-400 mb-0.5">Estimated cost</p>
              <p className="text-2xl font-bold text-stone-800">
                ${(parseInt(usage.total_cost_cents ?? "0") / 100).toFixed(2)}
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
