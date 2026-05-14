"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";

const MLS_OPTIONS = [
  { value: "", label: "None" },
  { value: "HAR", label: "HAR — Houston Association of Realtors" },
  { value: "ACTRIS", label: "ACTRIS — Austin/Central Texas" },
  { value: "CRMLS", label: "CRMLS — California Regional MLS" },
  { value: "SDMLS", label: "SDMLS — San Diego MLS" },
  { value: "BRIGHT", label: "Bright MLS — Mid-Atlantic" },
  { value: "FMLS", label: "FMLS — First Multiple Listing Service (Atlanta)" },
  { value: "BEACHES", label: "BeachesMLS — South Florida" },
  { value: "CA-AB723", label: "CA-AB723 — California Statewide" },
  { value: "WI-ACT69", label: "WI-Act69 — Wisconsin" },
];

const STYLE_OPTIONS = [
  { value: "", label: "Select a style…" },
  { value: "modern-transitional", label: "Modern Transitional" },
  { value: "modern-farmhouse", label: "Modern Farmhouse" },
  { value: "scandinavian", label: "Scandinavian" },
  { value: "mid-century-modern", label: "Mid-Century Modern" },
  { value: "traditional", label: "Traditional" },
  { value: "coastal", label: "Coastal" },
  { value: "industrial", label: "Industrial" },
];

export default function NewPropertyPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [mls, setMls] = useState("");
  const [style, setStyle] = useState("");
  const [colorNotes, setColorNotes] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim() || undefined,
          mls: mls || undefined,
          style_brief: {
            style: style || undefined,
            colorNotes: colorNotes.trim() || undefined,
            additionalNotes: additionalNotes.trim() || undefined,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      const data = await res.json();
      // API returns the created property object; id is in data.id or data itself
      const id = data.id ?? data.id;
      router.push(`/properties/${id}`);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="h-12 bg-stone-50 border-b border-stone-200 flex items-center px-4 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">VS</span>
            </div>
            <span className="text-sm font-semibold text-stone-800">Virtual Staging</span>
          </Link>
          <span className="text-stone-300 mx-1">/</span>
          <Link href="/properties" className="text-sm text-stone-500 hover:text-stone-700">
            Properties
          </Link>
          <span className="text-stone-300 mx-1">/</span>
          <span className="text-sm text-stone-600">New</span>
        </div>
        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>

      <div className="max-w-xl mx-auto px-6 py-8">
        {/* Back */}
        <Link
          href="/properties"
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 mb-6 transition-colors w-fit"
        >
          <ArrowLeft size={13} />
          Back to properties
        </Link>

        <h1 className="text-lg font-semibold text-stone-900 mb-6">New property</h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="name" className="block text-xs font-medium text-stone-600">
              Property name <span className="text-clay-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="123 Oak Street — Bedroom staging"
              required
              className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 outline-none focus:border-sage-400 focus:ring-2 focus:ring-sage-400/20 transition-colors bg-white"
            />
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <label htmlFor="address" className="block text-xs font-medium text-stone-600">
              Address <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Oak Street, Austin, TX 78701"
              className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 outline-none focus:border-sage-400 focus:ring-2 focus:ring-sage-400/20 transition-colors bg-white"
            />
          </div>

          {/* MLS */}
          <div className="space-y-1.5">
            <label htmlFor="mls" className="block text-xs font-medium text-stone-600">
              MLS board <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <select
              id="mls"
              value={mls}
              onChange={(e) => setMls(e.target.value)}
              className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 outline-none focus:border-sage-400 focus:ring-2 focus:ring-sage-400/20 transition-colors bg-white text-stone-700 appearance-none"
            >
              {MLS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Style brief section */}
          <div className="pt-2 border-t border-stone-100">
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-4">
              Style brief
            </p>

            {/* Style selector */}
            <div className="space-y-1.5 mb-4">
              <label htmlFor="style" className="block text-xs font-medium text-stone-600">
                Design style <span className="text-stone-400 font-normal">(optional)</span>
              </label>
              <select
                id="style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 outline-none focus:border-sage-400 focus:ring-2 focus:ring-sage-400/20 transition-colors bg-white text-stone-700 appearance-none"
              >
                {STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Color palette notes */}
            <div className="space-y-1.5 mb-4">
              <label htmlFor="color-notes" className="block text-xs font-medium text-stone-600">
                Color palette notes <span className="text-stone-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="color-notes"
                value={colorNotes}
                onChange={(e) => setColorNotes(e.target.value)}
                placeholder="e.g. Warm whites, greige tones, natural wood accents…"
                rows={2}
                className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 outline-none focus:border-sage-400 focus:ring-2 focus:ring-sage-400/20 transition-colors bg-white resize-none"
              />
            </div>

            {/* Additional notes */}
            <div className="space-y-1.5">
              <label htmlFor="additional-notes" className="block text-xs font-medium text-stone-600">
                Additional notes <span className="text-stone-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="additional-notes"
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="Any specific furniture, layout preferences, or style constraints…"
                rows={3}
                className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 outline-none focus:border-sage-400 focus:ring-2 focus:ring-sage-400/20 transition-colors bg-white resize-none"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-clay-500 bg-clay-400/5 border border-clay-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              disabled={submitting || !name.trim()}
              className="bg-sage-600 hover:bg-sage-700 text-white flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? "Creating…" : "Create property"}
            </Button>
            <Link
              href="/properties"
              className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
