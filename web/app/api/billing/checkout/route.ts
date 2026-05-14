import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStripe, TIERS } from "@/lib/stripe";
import { getStripeCustomerId } from "@/lib/billing";
import { z } from "zod";

const schema = z.object({
  tier: z.enum(["solo", "studio", "brokerage"]),
  billing: z.enum(["monthly", "annual"]).default("monthly"),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user as
    | { id?: string; email?: string; name?: string }
    | undefined;
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { tier, billing } = parsed.data;
  const tierConfig = TIERS[tier];
  const priceId =
    billing === "annual" ? tierConfig.annualPriceId : tierConfig.monthlyPriceId;

  if (!priceId) {
    return NextResponse.json(
      { error: "Price not configured for this tier" },
      { status: 500 }
    );
  }

  // Find or create Stripe customer
  let stripeCustomerId = await getStripeCustomerId(user.email);

  if (!stripeCustomerId) {
    const customer = await getStripe().customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: user.id ?? user.email },
    });
    stripeCustomerId = customer.id;
  }

  const trialDays = tier === "brokerage" ? 14 : 7;

  const checkoutSession = await getStripe().checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { trial_period_days: trialDays },
    success_url: `${process.env.NEXTAUTH_URL}/admin/billing?success=1`,
    cancel_url: `${process.env.NEXTAUTH_URL}/admin/billing?canceled=1`,
    metadata: { userId: user.id ?? user.email },
  });

  return NextResponse.json({ url: checkoutSession.url });
}
