import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, genId, migrate } from "@/lib/db";
import { provisionPersonalOrg } from "@/lib/orgs";

export async function POST(req: NextRequest) {
  try {
    await migrate();
    const { email, password, name } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await sql`SELECT id FROM users WHERE lower(email) = lower(${email})`;
    if (existing.length > 0) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = genId();
    const displayName = (typeof name === "string" && name.trim()) ? name.trim() : email.split("@")[0];

    await sql`
      INSERT INTO users (id, email, name, image, password_hash)
      VALUES (${userId}, ${email.toLowerCase()}, ${displayName}, '', ${passwordHash})
    `;

    await provisionPersonalOrg({ userId, userName: displayName, userEmail: email });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
