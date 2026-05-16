# Billing

## Plans

| Tier | Price | Generations | Seats |
|---|---|---|---|
| Free | $0 | 3 lifetime | 1 |
| Solo | $39/mo or annual | 25/mo | 1 |
| Studio | $149/mo or annual | 500/mo + overage | 1 |
| Brokerage | $399/mo or annual | 5000/mo | 5 |

Coupon: `FOUNDINGSTUDIO` = 33% off forever, max 25 redemptions.

## Quota enforcement

```ts
import { canGenerate, recordGeneration } from '@/lib/billing';
const { allowed, reason, tier } = await canGenerate(userId);
if (!allowed) return NextResponse.json({ error: 'quota_exceeded', reason }, { status: 402 });
await recordGeneration({ userId, orgId, nodeId, model, costCents });
```

Called before every Gemini invocation. Free tier = 3 lifetime; paid tiers = monthly rolling window. `recordGeneration` appends to `usage_events`.

## Stripe integration (`lib/stripe.ts`)

```ts
import { getStripe } from '@/lib/stripe'; // lazy singleton — safe at module level
```

Stripe products are live keys from the Altitude Development Partners LLC account. Price IDs are in env vars (`STRIPE_PRICE_SOLO_MONTHLY`, etc.).

**Checkout flow:** `POST /api/billing/checkout` → Stripe Checkout → redirect back → webhook fires.

**Webhook flow** (`POST /api/webhooks/stripe`):
- `checkout.session.completed` → create/link org → upsert `billing_subscriptions`
- `customer.subscription.updated/deleted` → update subscription status
- `invoice.payment_failed` → mark `past_due`
- All events check `stripe_events_processed` first for idempotency

**Customer Portal:** `POST /api/billing/portal` → Stripe-hosted portal for plan changes and cancellation.

## Sub-accounts (Brokerage)

`orgs.parent_org_id` self-references `orgs`. A Studio/Brokerage photographer creates child orgs for each agent client via `POST /api/admin/team`. Helpers in `lib/orgs.ts`:

```ts
import { getUserOrg, createSubAccount, listSubAccounts } from '@/lib/orgs';
const org = await getUserOrg(userId);
const { org: child } = await createSubAccount({ parentOrgId: org.id, name, clientEmail });
```
