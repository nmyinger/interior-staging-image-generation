import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, migrate } from "@/lib/db";
import { listSubAccounts, getUserOrg } from "@/lib/orgs";
import { redirect } from "next/navigation";
import Link from "next/link";

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  user_name: string;
  user_email: string;
}

export default async function TeamPage() {
  await migrate();
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/");
  }

  const uid = (session.user as { id?: string }).id ?? "";
  const org = await getUserOrg(uid);

  const members: MemberRow[] = org
    ? ((await sql`
        SELECT
          om.id,
          om.user_id,
          om.role,
          om.status,
          om.created_at,
          COALESCE(u.name, '')  AS user_name,
          COALESCE(u.email, '') AS user_email
        FROM org_members om
        JOIN users u ON u.id = om.user_id
        WHERE om.org_id = ${org.id} AND om.status = 'active'
        ORDER BY om.created_at ASC
      `) as MemberRow[])
    : [];

  const subAccounts = org ? await listSubAccounts(org.id) : [];

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const roleLabel: Record<string, string> = {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
    client: "Client",
  };

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VS</span>
          </div>
          <span className="text-sm font-semibold text-stone-800">Virtual Staging</span>
        </Link>
        <span className="text-stone-300 text-sm">/</span>
        <Link href="/admin" className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
          Admin
        </Link>
        <span className="text-stone-300 text-sm">/</span>
        <span className="text-sm text-stone-700">Team &amp; Clients</span>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-10">
        {/* Page title + action */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-stone-800">Team &amp; Clients</h1>
            <p className="text-xs text-stone-400 mt-1">
              Manage your team members and client workspaces
            </p>
          </div>
          <Link
            href="/admin/team/new"
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-lg px-3 py-2 transition-colors shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            New Client Workspace
          </Link>
        </div>

        {/* Your Team */}
        <section>
          <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
            Your Team
          </h2>
          {members.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-lg px-5 py-8 text-center">
              <p className="text-sm text-stone-400">No team members yet</p>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stone-100">
                    <th className="text-left text-xs text-stone-400 font-medium px-4 py-2.5">Name</th>
                    <th className="text-left text-xs text-stone-400 font-medium px-4 py-2.5">Email</th>
                    <th className="text-left text-xs text-stone-400 font-medium px-4 py-2.5">Role</th>
                    <th className="text-left text-xs text-stone-400 font-medium px-4 py-2.5">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => (
                    <tr
                      key={m.id}
                      className={i < members.length - 1 ? "border-b border-stone-100" : ""}
                    >
                      <td className="text-sm text-stone-800 px-4 py-3">
                        {m.user_name || <span className="text-stone-400 italic">—</span>}
                      </td>
                      <td className="text-sm text-stone-600 px-4 py-3">{m.user_email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            m.role === "owner"
                              ? "bg-sage-100 text-sage-700"
                              : m.role === "admin"
                              ? "bg-acacia-100 text-acacia-500"
                              : "bg-stone-100 text-stone-600"
                          }`}
                        >
                          {roleLabel[m.role] ?? m.role}
                        </span>
                      </td>
                      <td className="text-xs text-stone-400 px-4 py-3">{formatDate(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Client Workspaces */}
        <section>
          <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
            Client Workspaces
          </h2>

          {subAccounts.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-lg px-5 py-10 text-center">
              <p className="text-sm text-stone-500 font-medium">No client workspaces yet</p>
              <p className="text-xs text-stone-400 mt-1 max-w-xs mx-auto">
                Create a client workspace for each agent you deliver staging to
              </p>
              <Link
                href="/admin/team/new"
                className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-lg px-4 py-2 transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Create workspace
              </Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {subAccounts.map((sub) => {
                const pendingEmail =
                  typeof sub.settings === "object" && sub.settings !== null
                    ? (sub.settings as Record<string, unknown>).pending_client_email as string | undefined
                    : undefined;
                return (
                  <div
                    key={sub.id}
                    className="bg-white border border-stone-200 rounded-lg p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-800 truncate">{sub.name}</p>
                        {pendingEmail && (
                          <p className="text-xs text-stone-400 mt-0.5 truncate">{pendingEmail}</p>
                        )}
                      </div>
                      <Link
                        href={`/admin/team/${sub.id}`}
                        className="shrink-0 text-xs font-medium text-sage-700 bg-sage-50 hover:bg-sage-100 border border-sage-200 rounded-lg px-3 py-1.5 transition-colors"
                      >
                        View
                      </Link>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-stone-400">
                        {sub.property_count}{" "}
                        {sub.property_count === 1 ? "property" : "properties"}
                      </span>
                      <span className="text-stone-200 text-xs">·</span>
                      <span className="text-xs text-stone-400">
                        {sub.member_count}{" "}
                        {sub.member_count === 1 ? "member" : "members"}
                      </span>
                      <span className="text-stone-200 text-xs">·</span>
                      <span className="text-xs text-stone-400">
                        {formatDate(sub.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Back link */}
        <div className="pt-2">
          <Link
            href="/admin"
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
            Back to Admin
          </Link>
        </div>
      </div>
    </main>
  );
}
