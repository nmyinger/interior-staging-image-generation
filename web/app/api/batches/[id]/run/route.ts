import { NextRequest, NextResponse } from "next/server";
import { runBatchDirect } from "@/lib/jobs/run-batch-direct";

// POST /api/batches/[id]/run — dev-only internal endpoint to run a batch directly
// (without Inngest Dev Server). Called server-side via Next.js after().
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { id: batchId } = await params;
    await runBatchDirect(batchId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/batches/[id]/run]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
