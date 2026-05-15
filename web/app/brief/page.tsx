"use client";

import { useState } from "react";

function getNextTuesday(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 2=Tue
  const daysUntilTuesday = day <= 2 ? 2 - day : 9 - day;
  const tuesday = new Date(now);
  tuesday.setDate(now.getDate() + (daysUntilTuesday === 0 ? 7 : daysUntilTuesday));
  return tuesday.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function BriefPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const nextTuesday = getNextTuesday();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/brief/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Subscription failed");
      }
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Nav */}
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3">
        <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">VS</span>
        </div>
        <span className="text-sm font-semibold text-stone-800">
          Virtual Staging
        </span>
        <span className="text-stone-300 text-sm">/</span>
        <span className="text-sm text-stone-500">The Disclosure Brief</span>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-16 sm:py-24">
        {/* Eyebrow */}
        <p className="text-xs font-semibold text-sage-600 uppercase tracking-widest mb-4">
          Weekly Newsletter
        </p>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl font-bold text-stone-800 leading-tight mb-5">
          The Disclosure Brief
        </h1>

        {/* Subheadline */}
        <p className="text-lg text-stone-500 leading-relaxed mb-10">
          A weekly digest of AI disclosure law, MLS rule updates, and compliance
          best practices — written for real estate professionals who want to stay
          ahead of the curve, not scramble to catch up.
        </p>

        {/* What&apos;s inside */}
        <div className="bg-white border border-stone-200 rounded-xl p-6 mb-10">
          <h2 className="text-sm font-semibold text-stone-700 mb-4">
            What&apos;s in each issue:
          </h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-sage-100 flex items-center justify-center mt-0.5 shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M2 5.5L4 7.5L8 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-sage-600"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-stone-700">
                  Rule changes that affect your listings
                </p>
                <p className="text-xs text-stone-400 mt-0.5">
                  MLS board policy updates, new disclosure mandates, and
                  state-level bills in plain English — no legalese.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-sage-100 flex items-center justify-center mt-0.5 shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M2 5.5L4 7.5L8 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-sage-600"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-stone-700">
                  Case studies &amp; enforcement actions
                </p>
                <p className="text-xs text-stone-400 mt-0.5">
                  Real situations where staging disclosure went right — or wrong.
                  What agents were fined, and what they should have done.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-sage-100 flex items-center justify-center mt-0.5 shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M2 5.5L4 7.5L8 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-sage-600"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-stone-700">
                  Practical compliance tips
                </p>
                <p className="text-xs text-stone-400 mt-0.5">
                  Actionable checklists and workflow guides for brokerages and
                  solo agents using AI virtual staging tools.
                </p>
              </div>
            </li>
          </ul>
        </div>

        {/* Signup form or success */}
        {status === "success" ? (
          <div className="bg-sage-50 border border-sage-200 rounded-xl px-6 py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-sage-100 flex items-center justify-center mx-auto mb-4">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M3.5 9.5L7 13L14.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-sage-600"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-stone-800 mb-2">
              You&apos;re on the list.
            </h3>
            <p className="text-sm text-stone-500">
              First issue arrives {nextTuesday}. Check your inbox for a
              confirmation.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                placeholder="First name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 h-11 px-4 rounded-lg border border-stone-200 bg-white text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent"
              />
              <input
                type="email"
                placeholder="you@brokerage.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="flex-[2] h-11 px-4 rounded-lg border border-stone-200 bg-white text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={status === "loading" || !email}
              className="w-full h-11 rounded-lg bg-sage-600 text-white text-sm font-semibold hover:bg-sage-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === "loading" ? "Subscribing..." : "Subscribe — it's free"}
            </button>

            {status === "error" && (
              <p className="text-xs text-clay-500 text-center">{errorMsg}</p>
            )}

            <p className="text-xs text-stone-400 text-center">
              One email per week. No sponsored content. Unsubscribe anytime.
            </p>

            <p className="text-xs text-stone-400 text-center mt-2">
              Join 500+ real estate professionals. Unsubscribe anytime.
            </p>
          </form>
        )}

        {/* Social proof */}
        <div className="mt-12 pt-10 border-t border-stone-200">
          <p className="text-xs text-stone-400 mb-3 font-medium uppercase tracking-wider">
            Written by
          </p>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-acacia-200 flex items-center justify-center shrink-0">
              <span className="text-acacia-500 text-xs font-bold">N</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-700">Nik</p>
              <p className="text-xs text-stone-400 mt-0.5">
                Building virtual staging tools for real estate brokerages.
                Tracks AI disclosure law so you don&apos;t have to.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
