import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { sql } from "@/lib/db";

// DELETE /api/v1/webhooks/[id] — remove a webhook endpoint
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiAuth(req, async (orgId) => {
    try {
      const { id } = await params;

      // Verify the endpoint belongs to this org
      const rows = await sql`
        SELECT id FROM webhook_endpoints WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

      await sql`DELETE FROM webhook_endpoints WHERE id = ${id}`;

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[DELETE /api/v1/webhooks/[id]]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
