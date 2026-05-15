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

// ── Usage summary card — handles free and paid in one block ──────────────────

function UsageSummaryCard({
  details,
  currentTier,
}: {
  details: NonNullable<Awaited<ReturnType<typeof getSubscriptionDetails>>>;
  currentTier: Tier | "free";
}) {
  const isFree = currentTier === "free";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {isFree ? "Free tier usage" : "Usage this period"}
        </CardTitle>
        {!isFree && details.currentPeriodEnd && (
          <CardDescription>
            Resets{" "}
            {details.currentPeriodEnd.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
            })}
          </CardDescription>
        )}
        {isFree && (
          <CardDescription>
            {FREE_TIER_GENERATIONS} generations included — no credit card required
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <UsageBar
          used={details.usedGenerations}
          total={isFree ? FREE_TIER_GENERATIONS : details.includedGenerations}
        />
        {!isFree && details.cancelAtPeriodEnd && details.currentPeriodEnd && (
          <p className="text-xs text-clay-500">
            Subscription cancels on{" "}
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
      : `${config.includedGenerations} generations / mo`;

  const overageLabel =
    config.overageCents === 0
      ? null
      : tier === "brokerage"
      ? `+$${(config.overageCents / 100).toFixed(0)}/seat overage`
      : `+$${(config.overageCents / 100).toFixed(2)}/image overage`;

  const seatsLabel = config.seats ? `${config.seats} team seats` : null;

  return (
    <Card
      className={`flex flex-col transition-shadow ${
        isCurrent ? "ring-2 ring-sage-500 shadow-sm" : "hover:shadow-sm"
      }`}
    >
      <CardHeader className="pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base font-semibold text-stone-800">
                {config.name}
              </CardTitle>
              {isCurrent && (
                <Badge className="bg-sage-500 text-white border-0 text-xs px-2 py-0.5">
                  Current plan
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs mt-0.5">
              {prices.tagline}
            </CardDescription>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-stone-800">{prices.monthly}</p>
            <p className="text-xs text-stone-400">{prices.annual} billed annually</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-1.5 text-sm text-stone-600">
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
    <div>
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

        {/* Header */}
        <section className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-stone-800">Billing</h1>
            <p className="text-sm text-stone-500 mt-0.5">{user.email}</p>
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
        </section>

        {/* Usage — single card, handles free and paid */}
        {details && (
          <UsageSummaryCard details={details} currentTier={currentTier} />
        )}

        {/* Plans */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-stone-700">Plans</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch">
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
    </div>
  );
}
