import { migrate, sql } from "@/lib/db";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cookies } from "next/headers";
import { resolvePropertyAccess, verifyPasswordCookie, propertyPasswordCookieName } from "@/lib/access";
import { StageCanvas } from "@/components/canvas/StageCanvas";
import { CanvasHeader } from "@/components/CanvasHeader";

export default async function PropertyCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  await migrate();
  const { id: propertyId } = await params;

  const authSession = await getServerSession(authOptions);
  const uid = (authSession?.user as { id?: string } | undefined)?.id ?? null;
  const email = (authSession?.user as { email?: string } | undefined)?.email ?? null;

  const access = await resolvePropertyAccess(propertyId, uid, email);
  if (access.role === "none") notFound();

  if (access.needsPassword && access.passwordHash) {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(propertyPasswordCookieName(propertyId))?.value;
    if (!verifyPasswordCookie(cookieValue, propertyId, access.passwordHash)) {
      // Password-protect redirect — same pattern as session canvas
      notFound();
    }
  }

  const rows = await sql`SELECT name, created_by FROM properties WHERE id = ${propertyId}`;
  if (!rows.length) notFound();

  const { name, created_by } = rows[0] as { name: string; created_by: string };
  const readOnly = !access.canWrite;

  return (
    <main className="flex flex-col h-screen bg-stone-50">
      <CanvasHeader
        canvasId={propertyId}
        initialName={name}
        ownerUserId={created_by}
        propertyId={propertyId}
        readOnly={readOnly}
        isDemo={false}
      />
      <div className="flex-1 min-h-0">
        <StageCanvas propertyId={propertyId} readOnly={readOnly} />
      </div>
    </main>
  );
}
