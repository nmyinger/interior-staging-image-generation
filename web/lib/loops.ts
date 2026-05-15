import { LoopsClient } from "loops";

let _loops: LoopsClient | null = null;

function getLoops(): LoopsClient | null {
  if (!process.env.LOOPS_API_KEY) {
    return null;
  }
  if (!_loops) {
    _loops = new LoopsClient(process.env.LOOPS_API_KEY);
  }
  return _loops;
}

export async function subscribeToNewsletter(params: {
  email: string;
  firstName?: string;
  source: string;
}): Promise<void> {
  const loops = getLoops();
  if (!loops) {
    console.warn("[loops] LOOPS_API_KEY is not set — skipping Loops.so subscription");
    return;
  }

  try {
    await loops.createContact({
      email: params.email,
      properties: {
        firstName: params.firstName ?? null,
        source: params.source,
        userGroup: "disclosure-brief",
      },
    });
  } catch (err) {
    console.error("[loops] Failed to create Loops.so contact", err);
  }
}
