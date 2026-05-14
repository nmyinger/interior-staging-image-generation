import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSubscriptionDetails } from "@/lib/billing";
import { TIERS, FREE_TIER_GENERATIONS } from "@/lib/stripe";
import type { Tier } from "@/lib/stripe";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UpgradeButton, ManageBillingButton } from "./BillingActions";

// ── Tier price labels ────────────────────────────────────────────────────────

const TIER_PRICES: Record<Tier, { monthly: string; annual: string; tagline: string }> = {
  solo: {
    monthly: "$39/mo",
    annual: "$390/yr",
    tagline: "For individual agents & photographers",
  },
  studio: {
    monthly: "$149/mo",
    annual: "$1,490/yr",
    tagline: "For busy staging studios",
  },
  brokerage: {
    monthly: "$399/mo",
    annual: "$3,990/yr",
    tagline: "For teams — 5 seats, unlimited staging",
  },
};

// ── Usage bar ────────────────────────────────────────────────────────────────

function UsageBar({ used, total }: { used: number; total: number | null }) {
  if (total === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <span className="font-medium text-stone-800">{used}</span>
        <span>generations used — unlimited plan</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((used / total) * 100));
  const isNearLimit = pct >= 80;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-stone-500">
        <span>
          <span className="font-medium text-stone-800">{used}</span> / {total} generations
        </span>
        <span className={isNearLimit ? "text-clay-500 font-medium" : ""}>{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isNearLimit ? "bg-clay-400" : "bg-sage-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Tier card ────────────────────────────────────────────────────────────────

function TierCard({
  tier,
  isCurrent,
  hasSubscription,
}: {
  tier: Tier;
  isCurrent: boolean;
  hasSubscription: boolean;
}) {
  const config = TIERS[tier];
  const prices = TIER_PRICES[tier];

  const generationsLabel =
    config.includedGenerations === null
      ? "Unlimited generations"
      : `${config.includedGenerations} generations/mo`;

  const overageLabel =
    config.overageCents === 0
      ? null
      : tier === "brokerage"
      ? `+$${(config.overageCents / 100).toFixed(0)}/seat overage`
      : `+$${(config.overageCents / 100).toFixed(2)}/image overage`;

  const seatsLabel = config.seats ? `${config.seats} team seats` : null;

  return (
    <Card
      className={`relative transition-shadow ${
        isCurrent
          ? "ring-2 ring-sage-500 shadow-sm"
          : "hover:shadow-sm"
      }`}
    >
      {isCurrent && (
        <div className="absolute -top-3 left-4">
          <Badge className="bg-sage-500 text-white border-0 text-xs px-2 py-0.5">
            Current plan
          </Badge>
        </div>
      )}
      <CardHeader className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-stone-800">
              {config.name}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {prices.tagline}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-stone-800">{prices.monthly}</p>
            <p className="text-xs text-stone-400">{prices.annual} billed annually</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm text-stone-600">
        <p className="font-medium text-stone-800">{generationsLabel}</p>
        {seatsLabel && <p>{seatsLabel}</p>}
        {overageLabel && <p className="text-xs text-stone-400">{overageLabel}</p>}
      </CardContent>
      <CardFooter className="pt-2">
        {isCurrent ? (
          <ManageBillingButton className="w-full" />
        ) : (
          <UpgradeButton
            tier={tier}
            billing="monthly"
            label={hasSubscription ? `Switch to ${config.name}` : `Start ${config.name} trial`}
            className="w-full bg-sage-600 text-white hover:bg-sage-700 border-0"
          />
        )}
      </CardFooter>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; email?: string; name?: string } | undefined;
  if (!user?.id) redirect("/");

  const params = await searchParams;
  const details = await getSubscriptionDetails(user.id);

  const currentTier = details?.tier ?? "free";
  const hasSubscription = currentTier !== "free";

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="h-12 bg-stone-50 border-b border-stone-200 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VS</span>
          </div>
          <span className="text-sm font-semibold text-stone-800">Virtual Staging</span>
          <span className="text-stone-300 mx-1">/</span>
          <span className="text-sm text-stone-500">Billing</span>
        </div>
        <div className="ml-auto">
          <a href="/" className="text-xs text-stone-400 hover:text-stone-600">
            Back to sessions
          </a>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-10 space-y-10">
        {/* Flash messages */}
        {params.success && (
          <div className="rounded-lg bg-moss-500/10 border border-moss-500/30 px-4 py-3 text-sm text-moss-500 font-medium">
            Subscription activated — welcome aboard!
          </div>
        )}
        {params.canceled && (
          <div className="rounded-lg bg-stone-100 border border-stone-200 px-4 py-3 text-sm text-stone-500">
            Checkout canceled. Your plan was not changed.
          </div>
        )}

        {/* Current plan summary */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-stone-800">Billing</h1>
              <p className="text-sm text-stone-500 mt-0.5">
                {user.email}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {details?.status && (
                <Badge
                  variant={
                    details.status === "active" || details.status === "trialing"
                      ? "outline"
                      : "destructive"
                  }
                  className={
                    details.status === "active"
                      ? "border-moss-500 text-moss-500"
                      : details.status === "trialing"
                      ? "border-acacia-500 text-acacia-500"
                      : undefined
                  }
                >
                  {details.status === "trialing" ? "Trial" : details.status}
                </Badge>
              )}
              {currentTier === "free" && (
                <Badge variant="outline" className="border-stone-300 text-stone-500">
                  Free tier
                </Badge>
              )}
            </div>
          </div>

          {/* Usage this period */}
          {details && (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Usage this period</CardTitle>
                {details.currentPeriodEnd && (
                  <CardDescription>
                    Resets{" "}
                    {details.currentPeriodEnd.toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                    })}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <UsageBar
                  used={details.usedGenerations}
                  total={details.includedGenerations}
                />
                {details.cancelAtPeriodEnd && details.currentPeriodEnd && (
                  <p className="text-xs text-clay-500 mt-2">
                    Your subscription cancels on{" "}
                    {details.currentPeriodEnd.toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                    .
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {currentTier === "free" && (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Free tier</CardTitle>
                <CardDescription>
                  {FREE_TIER_GENERATIONS} generations included — no credit card required
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UsageBar
                  used={details?.usedGenerations ?? 0}
                  total={FREE_TIER_GENERATIONS}
                />
              </CardContent>
            </Card>
          )}
        </section>

        {/* Pricing table */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-stone-700">Plans</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["solo", "studio", "brokerage"] as Tier[]).map((tier) => (
              <TierCard
                key={tier}
                tier={tier}
                isCurrent={currentTier === tier}
                hasSubscription={hasSubscription}
              />
            ))}
          </div>
          <p className="text-xs text-stone-400 text-center">
            All plans include a free trial period. Cancel any time from the billing portal.
          </p>
        </section>
      </div>
    </main>
  );
}
