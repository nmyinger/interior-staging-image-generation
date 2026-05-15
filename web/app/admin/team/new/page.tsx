"use client";

import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewClientWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          clientEmail: clientEmail.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Something went wrong. Please try again.");
        return;
      }

      const data = (await res.json()) as { orgId: string };
      router.push(`/admin/team/${data.orgId}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <AppHeader breadcrumb={
        <>
          <Link href="/admin" className="text-sm text-stone-500 hover:text-stone-700 transition-colors">Admin</Link>
          <span className="text-stone-300 mx-0.5">/</span>
          <Link href="/admin/team" className="text-sm text-stone-500 hover:text-stone-700 transition-colors">Team</Link>
          <span className="text-stone-300 mx-0.5">/</span>
          <span className="text-sm text-stone-700">New Workspace</span>
        </>
      } />

      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-stone-800">New Client Workspace</h1>
          <p className="text-xs text-stone-400 mt-1">
            Set up an isolated space for one of your agent clients
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Workspace name */}
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-stone-700 mb-1.5"
            >
              Workspace name <span className="text-clay-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "The Smith Team" or "Jane Miller"'
              required
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent transition"
            />
          </div>

          {/* Client email (optional) */}
          <div>
            <label
              htmlFor="clientEmail"
              className="block text-sm font-medium text-stone-700 mb-1.5"
            >
              Client email{" "}
              <span className="text-xs font-normal text-stone-400">(optional)</span>
            </label>
            <input
              id="clientEmail"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="agent@example.com"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent transition"
            />
            <p className="text-xs text-stone-400 mt-1.5">
              If provided, they&apos;ll be added as workspace owner and can access it after signing in.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-clay-400/10 border border-clay-400/30 px-4 py-3">
              <p className="text-sm text-clay-600">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="flex items-center gap-2 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 disabled:bg-sage-300 disabled:cursor-not-allowed rounded-lg px-5 py-2.5 transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.3" />
                    <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  Creating…
                </>
              ) : (
                "Create workspace"
              )}
            </button>
            <Link
              href="/admin/team"
              className="text-sm font-medium text-stone-500 hover:text-stone-700 transition-colors px-3 py-2.5"
            >
              Cancel
            </Link>
          </div>
        </form>

        {/* Business context callout */}
        <div className="mt-10 bg-white border border-stone-200 rounded-lg p-5">
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
            How workspaces work
          </p>
          <p className="text-sm text-stone-600 leading-relaxed">
            Each workspace is isolated. Your client only sees their properties.
            You see everything.
          </p>
          <ul className="mt-3 space-y-1.5">
            {[
              "Clients log in with their own account",
              "Properties, batches, and images are scoped to the workspace",
              "You can view and manage all workspaces from this dashboard",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-stone-500">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className="mt-0.5 shrink-0 text-sage-500"
                >
                  <path
                    d="M2.5 6l2.5 2.5L9.5 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
