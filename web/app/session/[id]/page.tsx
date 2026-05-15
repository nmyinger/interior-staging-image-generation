import { redirect } from "next/navigation";

export default async function LegacySessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/canvas/${id}`);
}
