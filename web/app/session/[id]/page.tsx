import { migrate, sql } from "@/lib/db";
import { notFound } from "next/navigation";
import { StageCanvas } from "@/components/canvas/StageCanvas";
import { SessionHeader } from "@/components/SessionHeader";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  await migrate();
  const { id } = await params;

  const rows = await sql`SELECT id, name, owner_user_id FROM sessions WHERE id = ${id}`;
  if (!rows.length) notFound();

  const { name, owner_user_id } = rows[0] as { name: string; owner_user_id: string };

  return (
    <main className="flex flex-col h-screen bg-stone-50">
      <SessionHeader sessionId={id} initialName={name} ownerUserId={owner_user_id} />
      <div className="flex-1 min-h-0">
        <StageCanvas sessionId={id} />
      </div>
    </main>
  );
}
