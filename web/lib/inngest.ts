// Required env vars:
// INNGEST_EVENT_KEY  — from Inngest dashboard (event signing key)
// INNGEST_SIGNING_KEY — from Inngest dashboard (request signing key)

import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "virtual-staging",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export type BatchRunEvent = {
  name: "batch/run";
  data: { batchId: string };
};
