import { sql, genId } from "./db";
import { TIERS, FREE_TIER_GENERATIONS } from "./stripe";
import type { Tier } from "./stripe";

export type { Tier };

// Get current subscription for a user (by their user_id, look up via org)
export async function getSubscription(userId: string) {
  try {
    const rows = await sql`
      SELECT bs.*, om.org_id
      FROM billing_subscriptions bs
      JOIN org_members om ON om.org_id = bs.org_id
      WHERE om.user_id = ${userId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    // Billing tables don't exist yet — treat as no subscription
    return null;
  }
}

// Count generations used in the current billing period
export async function getUsageThisPeriod(
  orgId: string,
  periodStart: Date
): Promise<number> {
  try {
    const rows = await sql`
      SELECT COUNT(*) as count
      FROM usage_events
      WHERE org_id = ${orgId}
        AND billing_period_start = ${periodStart.toISOString()}
        AND kind IN ('generation', 'batch_generation')
    `;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

// Check if user can generate (within quota)
export async function canGenerate(
  userId: string
): Promise<{ allowed: boolean; reason?: string; tier: Tier | "free" }> {
  const sub = await getSubscription(userId);

  if (!sub) {
    // Free tier — count all-time generations for this user
    try {
      const rows = await sql`
        SELECT COUNT(*) as count FROM usage_events
        WHERE user_id = ${userId} AND kind = 'generation'
      `;
      const total = Number(rows[0]?.count ?? 0);
      if (total >= FREE_TIER_GENERATIONS) {
        return { allowed: false, reason: "free_quota_exceeded", tier: "free" };
      }
    } catch {
      // usage_events table doesn't exist yet — allow generation
    }
    return { allowed: true, tier: "free" };
  }

  if (sub.status !== "active" && sub.status !== "trialing") {
    return {
      allowed: false,
      reason: "subscription_inactive",
      tier: sub.tier as Tier,
    };
  }

  const tier = TIERS[sub.tier as Tier];
  if (tier.includedGenerations === null) {
    return { allowed: true, tier: sub.tier as Tier }; // unlimited
  }

  const used = await getUsageThisPeriod(
    sub.org_id as string,
    new Date(sub.current_period_start as string)
  );
  if (used >= tier.includedGenerations) {
    if (tier.overageCents === 0) {
      return {
        allowed: false,
        reason: "quota_exceeded",
        tier: sub.tier as Tier,
      };
    }
    // Overage allowed — will be billed at end of period
    return { allowed: true, tier: sub.tier as Tier };
  }

  return { allowed: true, tier: sub.tier as Tier };
}

// Record a generation event
export async function recordGeneration(params: {
  orgId: string | null;
  userId: string;
  model: string;
  costCents?: number;
  refId?: string;
  periodStart: Date;
}) {
  const { orgId, userId, model, costCents = 5, refId, periodStart } = params;
  const effectiveOrgId = orgId ?? `user:${userId}`;
  try {
    await sql`
      INSERT INTO usage_events (org_id, user_id, kind, model, cost_cents, ref_id, billing_period_start)
      VALUES (
        ${effectiveOrgId},
        ${userId},
        'generation',
        ${model},
        ${costCents},
        ${refId ?? null},
        ${periodStart.toISOString()}
      )
    `;
  } catch {
    // usage_events table doesn't exist yet — silently skip
    console.warn("[billing] usage_events table not found — skipping record");
  }
}

// Look up the Stripe customer ID for a user by email
export async function getStripeCustomerId(
  email: string
): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT bs.stripe_customer_id
      FROM billing_subscriptions bs
      JOIN org_members om ON om.org_id = bs.org_id
      JOIN users u ON u.id = om.user_id
      WHERE u.email = ${email}
      LIMIT 1
    `;
    return (rows[0]?.stripe_customer_id as string) ?? null;
  } catch {
    return null;
  }
}

// Determine tier from a Stripe price ID
export function tierFromPriceId(priceId: string): Tier {
  for (const [key, config] of Object.entries(TIERS)) {
    if (
      priceId === config.monthlyPriceId ||
      priceId === config.annualPriceId
    ) {
      return key as Tier;
    }
  }
  // Default to solo if unrecognized
  return "solo";
}

// Retrieve current subscription info for display (billing page)
export async function getSubscriptionDetails(userId: string): Promise<{
  tier: Tier | "free";
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  usedGenerations: number;
  includedGenerations: number | null;
  orgId: string | null;
} | null> {
  try {
    const sub = await getSubscription(userId);

    if (!sub) {
      // Free tier — count all-time generations for this user
      let used = 0;
      try {
        const rows = await sql`
          SELECT COUNT(*) as count FROM usage_events
          WHERE user_id = ${userId} AND kind = 'generation'
        `;
        used = Number(rows[0]?.count ?? 0);
      } catch (err) {
        console.warn("[billing] getSubscriptionDetails free-tier count failed:", err);
      }
      return {
        tier: "free",
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        usedGenerations: used,
        includedGenerations: FREE_TIER_GENERATIONS,
        orgId: null,
      };
    }

    const tier = sub.tier as Tier;
    const tierConfig = TIERS[tier];
    const periodStart = new Date(sub.current_period_start as string);
    const used = await getUsageThisPeriod(sub.org_id as string, periodStart);

    return {
      tier,
      status: sub.status as string,
      currentPeriodEnd: new Date(sub.current_period_end as string),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      stripeCustomerId: (sub.stripe_customer_id as string) ?? null,
      stripeSubscriptionId: (sub.stripe_subscription_id as string) ?? null,
      usedGenerations: used,
      includedGenerations: tierConfig.includedGenerations,
      orgId: sub.org_id as string,
    };
  } catch {
    return null;
  }
}

