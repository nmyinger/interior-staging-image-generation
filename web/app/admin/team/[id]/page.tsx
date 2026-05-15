import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, migrate } from "@/lib/db";
import { getUserOrg } from "@/lib/orgs";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

interface ChildOrgRow {
  id: string;
  name: string;
  type: string;
  slug: string;
  parent_org_id: string | null;
  settings: Record<string, unknown>;
  created_at: string;
}

interface PropertyRow {
  id: string;
  name: string;
  address: string | null;
  mls: string | null;
  status: string;
  created_at: string;
}

interface BatchSummaryRow {
  total: string;
  done: string;
  most_recent: string | null;
}

export default async function ClientWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await migrate();
  const { id: childOrgId } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/");
  }

  const uid = (session.user as { id?: string }).id ?? "";
  const parentOrg = await getUserOrg(uid);
  if (!parentOrg) redirect("/admin");

  // Verify the child org belongs to this parent
  const childRows = (await sql`
    SELECT id, name, type, slug, parent_org_id, settings, created_at
    FROM orgs
    WHERE id = ${childOrgId} AND parent_org_id = ${parentOrg.id}
    LIMIT 1
  `) as ChildOrgRow[];

  const child = childRows[0];
  if (!child) notFound();

  const clientEmail =
    typeof child.settings === "object" && child.settings !== null
      ? (child.settings as Record<string, unknown>).pending_client_email as string | undefined
      : undefined;

  // Properties for this workspace
  const properties = (await sql`
    SELECT id, name, address, mls, status, created_at
    FROM properties
    WHERE org_id = ${childOrgId}
    ORDER BY created_at DESC
  `) as PropertyRow[];

  // Batch summary
  const batchSummaryRows = (await sql`
    SELECT
      COUNT(*)::text                                             AS total,
      COUNT(*) FILTER (WHERE status = 'done')::text             AS done,
      MAX(finished_at)                                          AS most_recent
    FROM batches
    WHERE org_id = ${childOrgId}
  `) as BatchSummaryRow[];

  const batchSummary = batchSummaryRows[0] ?? { total: "0", done: "0", most_recent: null };

  const formatDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  const statusColors: Record<string, string> = {
    draft: "bg-stone-100 text-stone-500",
    queued: "bg-acacia-100 text-acacia-500",
    analyzing: "bg-acacia-100 text-acacia-500",
    generating: "bg-acacia-100 text-acacia-500",
    done: "bg-moss-500/10 text-moss-500",
    failed: "bg-clay-400/10 text-clay-500",
  };

  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {/* Workspace header */}
        <div className="bg-white border border-stone-200 rounded-lg p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-stone-800">{child.name}</h1>
              {clientEmail && (
                <p className="text-xs text-stone-400 mt-1">{clientEmail}</p>
              )}
              <p className="text-xs text-stone-400 mt-0.5">
                Created {formatDate(child.created_at)}
              </p>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-500 capitalize shrink-0">
              {child.type}
            </span>
          </div>

          {/* Batch stats */}
          <div className="mt-4 pt-4 border-t border-stone-100 flex items-center gap-8">
            <div>
              <p className="text-xs text-stone-400 mb-0.5">Total batches</p>
              <p className="text-xl font-bold text-stone-800">{batchSummary.total}</p>
            </div>
            <div className="w-px h-8 bg-stone-200" />
            <div>
              <p className="text-xs text-stone-400 mb-0.5">Completed</p>
              <p className="text-xl font-bold text-stone-800">{batchSummary.done}</p>
            </div>
            {batchSummary.most_recent && (
              <>
                <div className="w-px h-8 bg-stone-200" />
                <div>
                  <p className="text-xs text-stone-400 mb-0.5">Last staged</p>
                  <p className="text-sm font-semibold text-stone-700">
                    {formatDate(batchSummary.most_recent)}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Properties */}
        <section>
          <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
            Properties
          </h2>

          {properties.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-lg px-5 py-8 text-center">
              <p className="text-sm text-stone-400">No properties in this workspace yet</p>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stone-100">
                    <th className="text-left text-xs text-stone-400 font-medium px-4 py-2.5">Name</th>
                    <th className="text-left text-xs text-stone-400 font-medium px-4 py-2.5">Address</th>
                    <th className="text-left text-xs text-stone-400 font-medium px-4 py-2.5">Status</th>
                    <th className="text-left text-xs text-stone-400 font-medium px-4 py-2.5">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map((p, i) => (
                    <tr
                      key={p.id}
                      className={i < properties.length - 1 ? "border-b border-stone-100" : ""}
                    >
                      <td className="text-sm text-stone-800 px-4 py-3 font-medium">
                        {p.name}
                        {p.mls && (
                          <span className="ml-2 text-[11px] text-acacia-500 bg-acacia-100 border border-acacia-200 rounded-full px-1.5 py-0.5 font-medium">
                            {p.mls}
                          </span>
                        )}
                      </td>
                      <td className="text-xs text-stone-400 px-4 py-3">
                        {p.address ?? <span className="italic">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            statusColors[p.status] ?? "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="text-xs text-stone-400 px-4 py-3">
                        {formatDate(p.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
