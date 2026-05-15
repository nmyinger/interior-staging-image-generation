"use client";

import { useState, useMemo } from "react";
import type { DisclosureRow } from "./page";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateRange = "7d" | "30d" | "90d" | "all";
type StatusFilter = "active" | "revoked" | "all";

interface Props {
  orgName: string;
  initialDisclosures: DisclosureRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function truncate(str: string, max: number) {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

function todayMinus(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildCsv(rows: DisclosureRow[]): string {
  const headers = [
    "Date",
    "Property Name",
    "Property Address",
    "MLS",
    "Original URL",
    "Staged URL",
    "Disclosure URL",
    "Status",
  ];

  const escape = (v: string | null | undefined) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((d) =>
      [
        escape(formatDate(d.created_at)),
        escape(d.property_name),
        escape(d.property_address),
        escape(d.mls),
        escape(d.original_url),
        escape(d.staged_url),
        escape(`/v/${d.short_code}`),
        escape(d.revoked_at ? "Revoked" : "Active"),
      ].join(",")
    ),
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ComplianceDashboard({
  orgName,
  initialDisclosures,
}: Props) {
  const [disclosures, setDisclosures] =
    useState<DisclosureRow[]>(initialDisclosures);

  // Filter state
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [mlsFilter, setMlsFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");

  // Distinct MLS values for dropdown
  const mlsOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const d of disclosures) {
      if (d.mls) seen.add(d.mls);
    }
    return Array.from(seen).sort();
  }, [disclosures]);

  // Filtered rows
  const filtered = useMemo(() => {
    const cutoff: Date | null =
      dateRange === "7d"
        ? todayMinus(7)
        : dateRange === "30d"
        ? todayMinus(30)
        : dateRange === "90d"
        ? todayMinus(90)
        : null;

    const q = search.trim().toLowerCase();

    return disclosures.filter((d) => {
      // Date range
      if (cutoff && new Date(d.created_at) < cutoff) return false;

      // MLS
      if (mlsFilter !== "all") {
        if (d.mls !== mlsFilter) return false;
      }

      // Status
      const isRevoked = !!d.revoked_at;
      if (statusFilter === "active" && isRevoked) return false;
      if (statusFilter === "revoked" && !isRevoked) return false;

      // Search
      if (q) {
        const haystack = [d.property_name, d.property_address]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [disclosures, dateRange, mlsFilter, statusFilter, search]);

  // Stats (from filtered rows)
  const activeCount = filtered.filter((d) => !d.revoked_at).length;
  const revokedCount = filtered.filter((d) => d.revoked_at).length;
  const propertiesCount = useMemo(() => {
    const names = new Set(filtered.map((d) => d.property_name).filter(Boolean));
    return names.size;
  }, [filtered]);

  // CSV export
  function handleExport() {
    const csv = buildCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `disclosures-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Revoke
  async function handleRevoke(id: string) {
    const ok = window.confirm(
      "Revoke this disclosure? The public link will stop working."
    );
    if (!ok) return;

    const res = await fetch(`/api/admin/disclosures/${id}/revoke`, {
      method: "POST",
    });

    if (res.ok) {
      setDisclosures((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, revoked_at: new Date().toISOString() } : d
        )
      );
    } else {
      alert("Failed to revoke disclosure. Please try again.");
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* ── Nav header ─────────────────────────────────────────────────────── */}
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3">
        <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">VS</span>
        </div>
        <span className="text-sm font-semibold text-stone-800">
          Virtual Staging
        </span>
        <span className="text-stone-300 text-sm">/</span>
        <a
          href="/admin"
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          Admin
        </a>
        <span className="text-stone-300 text-sm">/</span>
        <span className="text-sm text-stone-700 font-medium">Compliance</span>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-5">
        {/* ── Header row ───────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-stone-800 mb-0.5">
              Compliance Audit
            </h1>
            <p className="text-sm text-stone-400">
              All disclosure links generated for{" "}
              <span className="text-stone-600 font-medium">{orgName}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Export CSV */}
            <button
              onClick={handleExport}
              className="h-8 px-3 rounded-lg border border-stone-300 text-xs font-medium text-stone-600 bg-white hover:bg-stone-50 transition-colors flex items-center gap-1.5"
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
            </button>

            {/* Date range */}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
              className="h-8 px-2.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-600 bg-white focus:outline-none focus:ring-1 focus:ring-stone-300 transition-colors"
            >
              <option value="all">All time</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </div>
        </div>

        {/* ── Stats bar ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-6 bg-white border border-stone-200 rounded-xl px-5 py-3.5">
          <StatItem
            value={activeCount}
            label="Active"
            dotClass="bg-moss-500"
          />
          <div className="w-px h-6 bg-stone-100" />
          <StatItem
            value={revokedCount}
            label="Revoked"
            dotClass="bg-stone-300"
          />
          <div className="w-px h-6 bg-stone-100" />
          <StatItem
            value={propertiesCount}
            label="Properties covered"
            dotClass="bg-acacia-400"
          />
        </div>

        {/* ── Filter bar ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* MLS */}
          <select
            value={mlsFilter}
            onChange={(e) => setMlsFilter(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-600 bg-white focus:outline-none focus:ring-1 focus:ring-stone-300 transition-colors"
          >
            <option value="all">All MLS boards</option>
            {mlsOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-8 px-2.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-600 bg-white focus:outline-none focus:ring-1 focus:ring-stone-300 transition-colors"
          >
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
            <option value="all">All statuses</option>
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
            >
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search property or address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 rounded-lg border border-stone-200 text-xs text-stone-700 bg-white placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-300 transition-colors"
            />
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        {filtered.length === 0 ? (
          <div className="bg-white border border-stone-200 rounded-xl py-16 text-center">
            <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                className="text-stone-400"
              >
                <rect
                  x="2"
                  y="2"
                  width="14"
                  height="14"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M5.5 9l2.5 2.5L12.5 7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-stone-600 mb-1">
              No disclosures match your filters.
            </p>
            <p className="text-xs text-stone-400">
              Try adjusting the filters above.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider whitespace-nowrap">
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
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider whitespace-nowrap">
                      Disclosure URL
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filtered.map((d) => {
                    const isRevoked = !!d.revoked_at;
                    return (
                      <tr
                        key={d.id}
                        className={`hover:bg-stone-50 transition-colors ${
                          isRevoked ? "opacity-50" : ""
                        }`}
                      >
                        {/* Date */}
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap text-xs">
                          {formatDate(d.created_at)}
                        </td>

                        {/* Property */}
                        <td className="px-4 py-3 max-w-[200px]">
                          {d.property_name ? (
                            <div>
                              <p className="text-stone-700 font-medium text-xs leading-tight truncate">
                                {d.property_name}
                              </p>
                              {d.property_address && (
                                <p className="text-xs text-stone-400 mt-0.5 truncate">
                                  {d.property_address}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-stone-400 text-xs">—</span>
                          )}
                        </td>

                        {/* MLS badge */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {d.mls ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 text-xs font-semibold">
                              {d.mls}
                            </span>
                          ) : (
                            <span className="text-stone-400 text-xs">—</span>
                          )}
                        </td>

                        {/* Original URL */}
                        <td className="px-4 py-3 max-w-[140px]">
                          <a
                            href={d.original_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={d.original_url}
                            className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2 transition-colors block truncate"
                          >
                            {truncate(d.original_url, 32)}
                          </a>
                        </td>

                        {/* Staged URL */}
                        <td className="px-4 py-3 max-w-[140px]">
                          <a
                            href={d.staged_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={d.staged_url}
                            className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2 transition-colors block truncate"
                          >
                            {truncate(d.staged_url, 32)}
                          </a>
                        </td>

                        {/* Disclosure URL */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <a
                            href={`/v/${d.short_code}`}
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

                        {/* Status badge */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {isRevoked ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-clay-500 font-medium">
                              <div className="w-1.5 h-1.5 rounded-full bg-clay-400" />
                              Revoked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs text-moss-500 font-medium">
                              <div className="w-1.5 h-1.5 rounded-full bg-moss-500" />
                              Active
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {!isRevoked && (
                            <button
                              onClick={() => handleRevoke(d.id)}
                              className="h-7 px-2.5 rounded-md border border-clay-400 text-xs font-medium text-clay-500 hover:bg-clay-400 hover:text-white transition-colors"
                            >
                              Revoke
                            </button>
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

        <p className="text-xs text-stone-400 pb-4">
          Showing up to 500 most recent disclosures. Use Export CSV for full audit history.
        </p>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatItem({
  value,
  label,
  dotClass,
}: {
  value: number;
  label: string;
  dotClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${dotClass}`} />
      <span className="text-sm text-stone-600">
        <span className="font-semibold text-stone-800">{value}</span>{" "}
        <span className="text-stone-500">{label}</span>
      </span>
    </div>
  );
}
