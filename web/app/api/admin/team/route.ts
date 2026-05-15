import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { getUserOrg, createSubAccount } from "@/lib/orgs";

const bodySchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  clientEmail: z.string().email("Invalid email").optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uid = (session.user as { id?: string }).id ?? "";
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { name, clientEmail } = parsed.data;

  // Resolve the user's org
  const org = await getUserOrg(uid);
  if (!org) {
    return NextResponse.json(
      { error: "No organization found. Please set up your account first." },
      { status: 403 }
    );
  }

  // Only studio and brokerage orgs can create client workspaces
  if (org.type !== "studio" && org.type !== "brokerage") {
    return NextResponse.json(
      { error: "Client workspaces require a Studio or Brokerage plan." },
      { status: 403 }
    );
  }

  const { org: childOrg } = await createSubAccount({
    parentOrgId: org.id,
    name,
    clientEmail,
  });

  return NextResponse.json({ orgId: childOrg.id }, { status: 201 });
}
