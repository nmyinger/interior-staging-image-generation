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

const adminLinks = [
  {
    href: "/admin/compliance",
    label: "Compliance",
    description: "Audit disclosure links and staged photo records",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-sage-600">
        <rect x="2" y="2" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 9l2.5 2.5L12.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/admin/billing",
    label: "Billing",
    description: "Manage subscription, invoices, and payment method",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-stone-500">
        <rect x="1.5" y="4" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M1.5 7.5h15" stroke="currentColor" strokeWidth="1.4" />
        <rect x="4" y="10" width="4" height="1.5" rx="0.75" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/admin/members",
    label: "Members",
    description: "Invite agents, assign roles, manage seats",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-stone-500">
        <circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 15c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/admin/brand",
    label: "Brand Settings",
    description: "Logo, watermark defaults, and styling preferences",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-stone-500">
        <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M9 1.5V3M9 15v1.5M1.5 9H3M15 9h1.5M3.697 3.697l1.06 1.06M13.243 13.243l1.06 1.06M3.697 14.303l1.06-1.06M13.243 4.757l1.06-1.06" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/admin/api-keys",
    label: "API Keys",
    description: "Manage API keys for batch integrations and webhooks",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-stone-500">
        <circle cx="6.5" cy="6.5" r="3.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M9.5 9.5L16 16M12.5 13l1.5 1.5M14.5 11l1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
];

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
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3">
        <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">VS</span>
        </div>
        <span className="text-sm font-semibold text-stone-800">
          Virtual Staging
        </span>
        <span className="text-stone-300 text-sm">/</span>
        <span className="text-sm text-stone-500">Admin</span>
      </header>

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

        {/* Nav grid */}
        <nav>
          <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">
            Settings &amp; Tools
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {adminLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="group flex items-start gap-4 bg-white border border-stone-200 rounded-xl px-5 py-4 hover:border-stone-300 hover:shadow-sm transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-stone-50 flex items-center justify-center shrink-0 group-hover:bg-stone-100 transition-colors">
                  {link.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-800 mb-0.5">
                    {link.label}
                  </p>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    {link.description}
                  </p>
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  className="text-stone-300 ml-auto mt-1 shrink-0 group-hover:text-stone-400 transition-colors"
                >
                  <path
                    d="M5 2.5L9.5 7L5 11.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            ))}
          </div>
        </nav>

        {/* Back to canvas */}
        <div className="pt-2">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-stone-600 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M9 2.5L4.5 7L9 11.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back to canvas
          </a>
        </div>
      </div>
    </main>
  );
}
