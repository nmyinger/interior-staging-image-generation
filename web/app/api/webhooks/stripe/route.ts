import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { tierFromPriceId } from "@/lib/billing";
import { sql, genId } from "@/lib/db";
import type Stripe from "stripe";

// Next.js App Router — body parsing is off by default for this route
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency check — skip if already processed
  try {
    await sql`
      INSERT INTO stripe_events_processed (stripe_event_id)
      VALUES (${event.id})
    `;
  } catch {
    // Either the table doesn't exist yet, or we already processed this event.
    // Either way, return 200 so Stripe doesn't retry.
    return NextResponse.json({ ok: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription
        );
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        // Unhandled event type — log and continue
        console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error("[stripe-webhook] handler error", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// In Stripe v22, current_period_start/end moved to SubscriptionItem level
function getPeriodFromSub(sub: Stripe.Subscription): { start: Date; end: Date } {
  const item = sub.items.data[0];
  const startSec = item?.current_period_start ?? sub.start_date ?? 0;
  const endSec = item?.current_period_end ?? sub.billing_cycle_anchor ?? 0;
  return {
    start: new Date(startSec * 1000),
    end: new Date(endSec * 1000),
  };
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription" || !session.subscription) return;

  const sub = await getStripe().subscriptions.retrieve(
    session.subscription as string
  );
  const customerId = session.customer as string;
  const userId = session.metadata?.userId ?? "";

  // Determine tier from the first line item's price ID
  const priceId = sub.items.data[0]?.price.id ?? "";
  const tier = tierFromPriceId(priceId);

  // Derive a stable org ID from the customer — reuse if the row already exists
  const existingOrg = await findOrgByCustomer(customerId);
  const orgId = existingOrg ?? `org_${genId()}`;

  const { start, end } = getPeriodFromSub(sub);

  try {
    // Ensure the org row exists — use tier as the org type, generate a unique slug
    const slug = `${tier}-${genId()}`;
    await sql`
      INSERT INTO orgs (id, type, name, slug, created_at)
      VALUES (${orgId}, ${tier}, ${`org-${customerId}`}, ${slug}, NOW())
      ON CONFLICT (id) DO NOTHING
    `;
  } catch {
    /* orgs table may not exist yet — non-fatal */
  }

  try {
    // Link the user to the org if we have a userId
    if (userId) {
      await sql`
        INSERT INTO org_members (id, org_id, user_id, role, created_at)
        VALUES (${genId()}, ${orgId}, ${userId}, 'owner', NOW())
        ON CONFLICT (org_id, user_id) DO NOTHING
      `;
    }
  } catch {
    /* org_members table may not exist — non-fatal */
  }

  try {
    await sql`
      INSERT INTO billing_subscriptions (
        id,
        org_id,
        stripe_customer_id,
        stripe_subscription_id,
        tier,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      )
      VALUES (
        ${genId()},
        ${orgId},
        ${customerId},
        ${sub.id},
        ${tier},
        ${sub.status},
        ${start.toISOString()},
        ${end.toISOString()},
        ${sub.cancel_at_period_end}
      )
      ON CONFLICT (org_id) DO UPDATE SET
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        stripe_customer_id     = EXCLUDED.stripe_customer_id,
        tier                   = EXCLUDED.tier,
        status                 = EXCLUDED.status,
        current_period_start   = EXCLUDED.current_period_start,
        current_period_end     = EXCLUDED.current_period_end,
        cancel_at_period_end   = EXCLUDED.cancel_at_period_end
    `;
  } catch (err) {
    console.error("[stripe-webhook] failed to upsert billing_subscriptions", err);
    throw err;
  }
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const priceId = sub.items.data[0]?.price.id ?? "";
  const tier = tierFromPriceId(priceId);
  const { start, end } = getPeriodFromSub(sub);

  try {
    await sql`
      UPDATE billing_subscriptions SET
        tier                 = ${tier},
        status               = ${sub.status},
        current_period_start = ${start.toISOString()},
        current_period_end   = ${end.toISOString()},
        cancel_at_period_end = ${sub.cancel_at_period_end}
      WHERE stripe_subscription_id = ${sub.id}
    `;
  } catch {
    /* table may not exist */
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  try {
    await sql`
      UPDATE billing_subscriptions
      SET status = 'canceled'
      WHERE stripe_subscription_id = ${sub.id}
    `;
  } catch {
    /* table may not exist */
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  try {
    await sql`
      UPDATE billing_subscriptions
      SET status = 'past_due'
      WHERE stripe_customer_id = ${invoice.customer as string}
    `;
  } catch {
    /* table may not exist */
  }
}

async function findOrgByCustomer(customerId: string): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT org_id FROM billing_subscriptions
      WHERE stripe_customer_id = ${customerId}
      LIMIT 1
    `;
    return (rows[0]?.org_id as string) ?? null;
  } catch {
    return null;
  }
}
