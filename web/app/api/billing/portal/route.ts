import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { getStripeCustomerId } from "@/lib/billing";

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user as
    | { id?: string; email?: string; name?: string }
    | undefined;
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeCustomerId = await getStripeCustomerId(user.email);
  if (!stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing account found" },
      { status: 404 }
    );
  }

  const portalSession = await getStripe().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${process.env.NEXTAUTH_URL}/admin/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
