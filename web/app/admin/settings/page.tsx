"use client";

import { useEffect, useState } from "react";

interface MlsRule {
  code: string;
  display_name: string;
  jurisdiction: string | null;
  watermark: { gravity?: string; position?: string; text?: string };
  requires_original_url: boolean;
  disclosure_text: string;
}

interface SettingsResponse {
  settings: { activeMls?: string[] };
  mlsRules: MlsRule[];
}

const MLS_META: Record<string, { label: string; description: string }> = {
  HAR:      { label: "HAR (Houston MLS)",        description: "Houston, TX" },
  ACTRIS:   { label: "ACTRIS",                   description: "Austin, TX" },
  "CA-AB723": { label: "California AB 723",       description: "Statewide — required Jan 2026" },
  "WI-ACT69": { label: "Wisconsin Act 69",        description: "Statewide" },
  CRMLS:    { label: "CRMLS",                    description: "Southern California" },
  SDMLS:    { label: "SDMLS",                    description: "San Diego, CA" },
  BRIGHT:   { label: "Bright MLS",               description: "Mid-Atlantic" },
  FMLS:     { label: "FMLS",                     description: "Atlanta, GA" },
  BEACHES:  { label: "Beaches MLS",              description: "South Florida" },
};

export default function OrgSettingsPage() {
  const [rules, setRules] = useState<MlsRule[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data: SettingsResponse) => {
        setRules(data.mlsRules ?? []);
        setSelected(new Set(data.settings?.activeMls ?? []));
      })
      .catch(() => setError("Failed to load settings."))
      .finally(() => setLoading(false));
  }, []);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeMls: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Save failed.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3">
        <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">VS</span>
        </div>
        <span className="text-sm font-semibold text-stone-800">Virtual Staging</span>
        <span className="text-stone-300 text-sm">/</span>
        <a href="/admin" className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
          Admin
        </a>
        <span className="text-stone-300 text-sm">/</span>
        <span className="text-sm text-stone-500">Settings</span>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {/* Page heading */}
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Workspace Settings</h1>
        </div>

        {/* MLS Compliance section */}
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-stone-800">MLS Compliance Rules</h2>
            <p className="text-sm text-stone-500 mt-0.5">
              Select the MLS boards your listings are filed in. Watermark rules auto-apply.
            </p>
          </div>

          {loading ? (
            <div className="grid sm:grid-cols-3 gap-3">
              {[...Array(9)].map((_, i) => (
                <div
                  key={i}
                  className="h-28 rounded-xl border border-stone-200 bg-white animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid sm:grid-cols-3 gap-3">
              {rules.map((rule) => {
                const meta = MLS_META[rule.code];
                const isActive = selected.has(rule.code);
                const gravity = rule.watermark?.gravity ?? rule.watermark?.position ?? null;

                return (
                  <button
                    key={rule.code}
                    type="button"
                    onClick={() => toggle(rule.code)}
                    className={[
                      "relative text-left rounded-xl border px-4 py-3.5 transition-all focus:outline-none",
                      "focus-visible:ring-2 focus-visible:ring-sage-500 focus-visible:ring-offset-2",
                      isActive
                        ? "border-sage-500 bg-sage-50"
                        : "border-stone-200 bg-white hover:border-stone-300",
                    ].join(" ")}
                  >
                    {/* Checkbox indicator */}
                    <span
                      className={[
                        "absolute top-3 right-3 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        isActive
                          ? "bg-sage-600 border-sage-600"
                          : "border-stone-300 bg-white",
                      ].join(" ")}
                      aria-hidden="true"
                    >
                      {isActive && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path
                            d="M1 4l3 3L9 1"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>

                    {/* Label */}
                    <p className="text-sm font-semibold text-stone-800 pr-6 leading-tight">
                      {meta?.label ?? rule.display_name}
                    </p>

                    {/* Description */}
                    <p className="text-xs text-stone-400 mt-0.5">
                      {meta?.description ?? rule.jurisdiction ?? ""}
                    </p>

                    {/* Badges */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {rule.requires_original_url && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-moss-500/10 text-moss-500 leading-none">
                          Original URL required
                        </span>
                      )}
                      {gravity && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-stone-400 bg-stone-100 leading-none">
                          Watermark: {gravity}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* No-selection warning */}
          {!loading && selected.size === 0 && (
            <p className="text-sm text-acacia-500 bg-acacia-100 rounded-lg px-4 py-3">
              No MLS rules applied. All images use default watermark.
            </p>
          )}
        </section>

        {/* Error */}
        {error && (
          <p className="text-sm text-clay-500 bg-clay-400/10 rounded-lg px-4 py-3">{error}</p>
        )}

        {/* Save row */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className={[
              "px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors",
              "sm:w-auto w-full",
              saving || loading
                ? "bg-sage-400 cursor-not-allowed"
                : "bg-sage-600 hover:bg-sage-700",
            ].join(" ")}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>

          {saved && (
            <span className="text-sm font-medium text-moss-500 transition-opacity">Saved!</span>
          )}
        </div>

        {/* Back link */}
        <div className="pt-2">
          <a
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
            Back to admin
          </a>
        </div>
      </div>
    </main>
  );
}
