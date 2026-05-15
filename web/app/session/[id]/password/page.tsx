import { redirect } from "next/navigation";

export default async function LegacyPasswordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/canvas/${id}/password`);
}
