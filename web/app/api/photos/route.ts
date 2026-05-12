import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const rows = await sql`
    SELECT filename, room_type, zone, default_prompt
    FROM photos
    ORDER BY zone, filename
  `;
  return NextResponse.json({ photos: rows });
}
