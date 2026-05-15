import crypto from "crypto";
import { inngest } from "@/lib/inngest";
import { sql, genId } from "@/lib/db";

// ---------------------------------------------------------------------------
// Event types handled by this function
// ---------------------------------------------------------------------------
type WebhookTriggerEvent =
  | { name: "batch/completed"; data: { batchId: string; orgId: string; propertyId: string } }
  | { name: "batch/failed"; data: { batchId: string; orgId: string; propertyId: string; error?: string } };

// Map Inngest event names → the event string embedded in webhook payloads
const EVENT_NAME_MAP: Record<string, string> = {
  "batch/completed": "batch.completed",
  "batch/failed": "batch.failed",
};

// ---------------------------------------------------------------------------
// Webhook delivery Inngest function
// ---------------------------------------------------------------------------
export const webhookDeliveryFunction = inngest.createFunction(
  {
    id: "webhook-delivery",
    retries: 3,
    triggers: [{ event: "batch/completed" }, { event: "batch/failed" }],
  },
  async ({ event, step }: { event: WebhookTriggerEvent; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const { orgId } = event.data;
    const webhookEventName = EVENT_NAME_MAP[event.name] ?? event.name;

    // -----------------------------------------------------------------------
    // Step 1: Fetch all active webhook endpoints for this org + event
    // -----------------------------------------------------------------------
    type EndpointRow = {
      id: string;
      url: string;
      secret: string;
      events: string[];
    };

    const endpoints = await step.run("fetch-endpoints", async () => {
      const rows = await sql`
        SELECT id, url, secret, events
        FROM webhook_endpoints
        WHERE org_id = ${orgId}
      `;
      // Filter to endpoints that listen to this event
      return (rows as EndpointRow[]).filter(
        (ep) => ep.events.includes(webhookEventName) || ep.events.includes("*")
      );
    });

    if (endpoints.length === 0) {
      return { delivered: 0, skipped: "no matching endpoints" };
    }

    // -----------------------------------------------------------------------
    // Step 2: Deliver to each endpoint in a separate step (parallelism + retry)
    // -----------------------------------------------------------------------
    const payload = {
      event: webhookEventName,
      data: event.data,
      timestamp: new Date().toISOString(),
    };

    let successCount = 0;

    await Promise.all(
      endpoints.map(async (endpoint) => {
        return step.run(`deliver-${endpoint.id}`, async () => {
          const body = JSON.stringify(payload);

          // HMAC-SHA256 signature
          const hmac = crypto.createHmac("sha256", endpoint.secret);
          hmac.update(body);
          const signature = "sha256=" + hmac.digest("hex");

          const deliveryId = genId();
          let httpStatus: number | null = null;
          let deliveryStatus: "delivered" | "failed" = "failed";

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);

            let resp: Response;
            try {
              resp = await fetch(endpoint.url, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-staging-signature": signature,
                },
                body,
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timeout);
            }

            httpStatus = resp.status;
            if (httpStatus >= 200 && httpStatus < 300) {
              deliveryStatus = "delivered";
              successCount++;
            }
          } catch {
            // Timeout or network error — deliveryStatus stays 'failed'
          }

          await sql`
            INSERT INTO webhook_deliveries (id, endpoint_id, event, payload, status, attempts, delivered_at)
            VALUES (
              ${deliveryId},
              ${endpoint.id},
              ${webhookEventName},
              ${JSON.stringify(payload)},
              ${httpStatus},
              1,
              ${deliveryStatus === "delivered" ? new Date().toISOString() : null}
            )
          `;

          return { endpointId: endpoint.id, status: deliveryStatus, httpStatus };
        });
      })
    );

    return { delivered: successCount, total: endpoints.length };
  }
);
