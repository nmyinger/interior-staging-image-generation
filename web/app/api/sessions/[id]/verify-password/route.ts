import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verifyPassword, createPasswordCookie, passwordCookieName } from "@/lib/access";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { password } = await req.json() as { password: string };
  if (!password) return NextResponse.json({ error: "password required" }, { status: 400 });

  const rows = await sql`SELECT share_password_hash FROM sessions WHERE id = ${id}`;
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const hash = rows[0].share_password_hash as string | null;
  if (!hash) return NextResponse.json({ error: "No password set" }, { status: 400 });

  if (!verifyPassword(password, hash)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const cookieValue = createPasswordCookie(id, hash);
  const cookieName = passwordCookieName(id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}
