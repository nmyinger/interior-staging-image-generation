import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { batchRunFunction } from "@/lib/jobs/batch-run";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [batchRunFunction],
});
