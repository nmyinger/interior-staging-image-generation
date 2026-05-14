// Required environment variables:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   STRIPE_PRICE_SOLO_MONTHLY
//   STRIPE_PRICE_SOLO_ANNUAL
//   STRIPE_PRICE_STUDIO_MONTHLY
//   STRIPE_PRICE_STUDIO_ANNUAL
//   STRIPE_PRICE_BROKERAGE_MONTHLY
//   STRIPE_PRICE_BROKERAGE_ANNUAL

import Stripe from "stripe";

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apiVersion: "2026-04-22.dahlia" as any,
    });
  }
  return _stripe;
}

export type Tier = "solo" | "studio" | "brokerage";

export const TIERS: Record<
  Tier,
  {
    name: string;
    monthlyPriceId: string;
    annualPriceId: string;
    includedGenerations: number | null;
    overageCents: number;
    seats: number | null;
  }
> = {
  solo: {
    name: "Solo",
    monthlyPriceId: process.env.STRIPE_PRICE_SOLO_MONTHLY!,
    annualPriceId: process.env.STRIPE_PRICE_SOLO_ANNUAL!,
    includedGenerations: 25,
    overageCents: 0,
    seats: null,
  },
  studio: {
    name: "Studio",
    monthlyPriceId: process.env.STRIPE_PRICE_STUDIO_MONTHLY!,
    annualPriceId: process.env.STRIPE_PRICE_STUDIO_ANNUAL!,
    includedGenerations: 500,
    overageCents: 150, // $1.50
    seats: null,
  },
  brokerage: {
    name: "Brokerage",
    monthlyPriceId: process.env.STRIPE_PRICE_BROKERAGE_MONTHLY!,
    annualPriceId: process.env.STRIPE_PRICE_BROKERAGE_ANNUAL!,
    includedGenerations: null, // unlimited
    overageCents: 3900, // $39/seat
    seats: 5,
  },
};

export const FREE_TIER_GENERATIONS = 3;
