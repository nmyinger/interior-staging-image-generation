import { migrate, sql } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cookies } from "next/headers";
import { resolveAccess, verifyPasswordCookie, passwordCookieName } from "@/lib/access";
import { StageCanvas } from "@/components/canvas/StageCanvas";
import { CanvasHeader } from "@/components/CanvasHeader";

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  await migrate();
  const { id } = await params;

  const authSession = await getServerSession(authOptions);
  const uid = (authSession?.user as { id?: string } | undefined)?.id ?? null;
  const email = (authSession?.user as { email?: string } | undefined)?.email ?? null;

  const access = await resolveAccess(id, uid, email);

  if (access.role === "none") notFound();

  if (access.needsPassword && access.passwordHash) {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(passwordCookieName(id))?.value;
    if (!verifyPasswordCookie(cookieValue, id, access.passwordHash)) {
      redirect(`/canvas/${id}/password`);
    }
  }

  const rows = await sql`SELECT name, owner_user_id, property_id FROM sessions WHERE id = ${id}`;
  if (!rows.length) notFound();

  const { name, owner_user_id, property_id } = rows[0] as {
    name: string;
    owner_user_id: string;
    property_id: string | null;
  };
  const readOnly = !access.canWrite;

  return (
    <main className="flex flex-col h-screen bg-stone-50">
      <CanvasHeader
        canvasId={id}
        initialName={name}
        ownerUserId={owner_user_id}
        propertyId={property_id}
        readOnly={readOnly}
      />
      <div className="flex-1 min-h-0">
        <StageCanvas sessionId={id} readOnly={readOnly} />
      </div>
    </main>
  );
}
