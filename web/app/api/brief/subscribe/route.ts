// Required env var: RESEND_API_KEY
// Optional: set RESEND_FROM_DOMAIN to your verified sending domain (default: resend.dev)
// Optional: set LOOPS_API_KEY to enable Loops.so lifecycle automation

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { subscribeToNewsletter } from "@/lib/loops";

const schema = z.object({
  email: z.string().email(),
  name: z.string().max(100).optional(),
});

const FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN ?? "resend.dev";
const BRIEF_FROM = `The Disclosure Brief <brief@${FROM_DOMAIN}>`;
const NOTIFY_FROM = `Brief Signup <notify@${FROM_DOMAIN}>`;
const OWNER_EMAIL = "nik@altitudedp.com";
const APP_URL = process.env.NEXTAUTH_URL ?? "https://app.virtualstagingai.com";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const { email, name } = parsed.data;

  // Send welcome email to subscriber
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: BRIEF_FROM,
      to: email,
      subject: "You're subscribed to The Disclosure Brief",
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #292524; padding: 40px 24px;">
          <div style="margin-bottom: 32px;">
            <div style="display: inline-block; background: #4a7c59; border-radius: 6px; padding: 6px 10px; margin-bottom: 16px;">
              <span style="color: white; font-size: 11px; font-weight: bold; letter-spacing: 0.05em;">THE DISCLOSURE BRIEF</span>
            </div>
          </div>

          <h1 style="font-size: 24px; color: #1c1917; margin: 0 0 16px; font-weight: 700; line-height: 1.3;">
            Welcome, ${name ?? "there"}.
          </h1>

          <p style="font-size: 15px; line-height: 1.7; color: #57534e; margin: 0 0 16px;">
            You're now subscribed to the weekly digest of AI disclosure law, MLS rule updates, and
            compliance best practices for real estate professionals.
          </p>

          <p style="font-size: 15px; line-height: 1.7; color: #57534e; margin: 0 0 16px;">
            The first issue arrives Tuesday. Each week I cover:
          </p>

          <ul style="font-size: 15px; line-height: 1.7; color: #57534e; margin: 0 0 24px; padding-left: 20px;">
            <li style="margin-bottom: 6px;">MLS rule changes that affect your listings</li>
            <li style="margin-bottom: 6px;">Enforcement actions and case studies</li>
            <li>Practical compliance workflows for AI-staged photos</li>
          </ul>

          <p style="font-size: 15px; line-height: 1.7; color: #57534e; margin: 0 0 32px;">
            In the meantime, check out our
            <a href="${APP_URL}" style="color: #4a7c59; text-decoration: underline;">virtual staging tool</a>
            — it handles AB 723 compliance automatically, generating a disclosure link for every
            staged photo.
          </p>

          <div style="border-top: 1px solid #e7e5e4; padding-top: 24px;">
            <p style="font-size: 13px; color: #78716c; margin: 0; line-height: 1.6;">
              — Nik<br>
              <a href="mailto:nik@altitudedp.com" style="color: #78716c;">nik@altitudedp.com</a>
            </p>
          </div>

          <p style="font-size: 11px; color: #a8a29e; margin: 24px 0 0; line-height: 1.6;">
            You subscribed at ${APP_URL}/brief. One email per week. No sponsored content.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error("Failed to send welcome email", err);
    // Don't fail the request if email delivery fails
  }

  // Non-blocking: add to Loops.so for lifecycle automation
  await subscribeToNewsletter({
    email: parsed.data.email,
    firstName: parsed.data.name?.split(" ")[0],
    source: "brief-page",
  }).catch(() => {}); // already logs internally

  // Notify owner of new subscriber
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: NOTIFY_FROM,
      to: OWNER_EMAIL,
      subject: `New subscriber: ${email}`,
      text: `${email} (${name ?? "no name"}) subscribed to The Disclosure Brief`,
    });
  } catch {
    // Ignore notification failures
  }

  return NextResponse.json({ ok: true });
}
