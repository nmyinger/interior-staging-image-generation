import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, migrate } from "@/lib/db";
import { redirect } from "next/navigation";

interface DisclosureRow {
  id: string;
  short_code: string;
  original_url: string;
  staged_url: string;
  mls: string | null;
  disclosure_text: string;
  created_at: string;
  revoked_at: string | null;
  property_name: string | null;
  property_address: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
    disclosures = (await sql`
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
      LIMIT 100
    `) as DisclosureRow[];
  }

  const activeCount = disclosures.filter((d) => !d.revoked_at).length;
  const revokedCount = disclosures.filter((d) => d.revoked_at).length;

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3">
        <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">VS</span>
        </div>
        <span className="text-sm font-semibold text-stone-800">
          Virtual Staging
        </span>
        <span className="text-stone-300 text-sm">/</span>
        <a href="/admin" className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
          Admin
        </a>
        <span className="text-stone-300 text-sm">/</span>
        <span className="text-sm text-stone-700 font-medium">Compliance</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            disabled
            title="Coming soon"
            className="h-8 px-3 rounded-lg border border-stone-200 text-xs font-medium text-stone-400 bg-stone-50 cursor-not-allowed flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 1v6M3 8.5l3 2.5 3-2.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Export CSV
            <span className="text-[10px] text-stone-300 font-normal ml-0.5">
              coming soon
            </span>
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Page title + stats */}
        <div>
          <h1 className="text-xl font-bold text-stone-800 mb-1">
            Compliance Audit
          </h1>
          <p className="text-sm text-stone-400">
            All disclosure links generated for{" "}
            <span className="text-stone-600 font-medium">{org?.name ?? "your organization"}</span>
          </p>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-moss-500" />
            <span className="text-sm text-stone-600">
              <span className="font-semibold">{activeCount}</span> active
            </span>
          </div>
          {revokedCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-stone-300" />
              <span className="text-sm text-stone-600">
                <span className="font-semibold">{revokedCount}</span> revoked
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-stone-200" />
            <span className="text-sm text-stone-600">
              <span className="font-semibold">{disclosures.length}</span> total
            </span>
          </div>
        </div>

        {/* Table */}
        {disclosures.length === 0 ? (
          <div className="bg-white border border-stone-200 rounded-xl py-16 text-center">
            <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-stone-400">
                <rect x="2" y="2" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.4" />
                <path d="M5.5 9l2.5 2.5L12.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-sm font-medium text-stone-600 mb-1">
              No disclosures yet
            </p>
            <p className="text-xs text-stone-400">
              Disclosures are generated automatically when you stage photos.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Property
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      MLS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Original
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Staged
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Disclosure URL
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {disclosures.map((d) => {
                    const disclosureUrl = `/v/${d.short_code}`;
                    const isRevoked = !!d.revoked_at;

                    return (
                      <tr
                        key={d.id}
                        className={`hover:bg-stone-50 transition-colors ${isRevoked ? "opacity-50" : ""}`}
                      >
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                          {formatDate(d.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          {d.property_name ? (
                            <div>
                              <p className="text-stone-700 font-medium leading-tight">
                                {d.property_name}
                              </p>
                              {d.property_address && (
                                <p className="text-xs text-stone-400 mt-0.5">
                                  {d.property_address}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {d.mls ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-acacia-100 text-acacia-500 text-xs font-semibold">
                              {d.mls}
                            </span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={d.original_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2 transition-colors"
                          >
                            Original
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={d.staged_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2 transition-colors"
                          >
                            Staged
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={disclosureUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-sage-600 hover:text-sage-700 font-medium transition-colors"
                          >
                            /v/{d.short_code}
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 10 10"
                              fill="none"
                            >
                              <path
                                d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6M6 1h3m0 0v3m0-3L5 6"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </a>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {isRevoked ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-stone-400">
                              <div className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                              Revoked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs text-moss-500">
                              <div className="w-1.5 h-1.5 rounded-full bg-moss-500" />
                              Active
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs text-stone-400 pb-4">
          Showing the most recent 100 disclosures. Export to CSV for full
          audit history.
        </p>
      </div>
    </main>
  );
}
