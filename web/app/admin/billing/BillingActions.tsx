"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Tier } from "@/lib/stripe";

// ── Upgrade / checkout button ───────────────────────────────────────────────

interface UpgradeButtonProps {
  tier: Tier;
  billing?: "monthly" | "annual";
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function UpgradeButton({
  tier,
  billing = "monthly",
  label = "Upgrade",
  disabled = false,
  className,
}: UpgradeButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, billing }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Checkout error:", data);
        setLoading(false);
      }
    } catch (err) {
      console.error("Checkout request failed:", err);
      setLoading(false);
    }
  }

  return (
    <Button
      onClick={handleClick}
      disabled={disabled || loading}
      className={className}
    >
      {loading ? "Redirecting…" : label}
    </Button>
  );
}

// ── Manage billing (portal) button ──────────────────────────────────────────

interface ManageBillingButtonProps {
  className?: string;
}

export function ManageBillingButton({ className }: ManageBillingButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Portal error:", data);
        setLoading(false);
      }
    } catch (err) {
      console.error("Portal request failed:", err);
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={loading} className={className}>
      {loading ? "Opening portal…" : "Manage billing"}
    </Button>
  );
}
