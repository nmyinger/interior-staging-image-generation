import { migrate } from "@/lib/db";
import { PasswordForm } from "./PasswordForm";

export default async function PasswordPage({ params }: { params: Promise<{ id: string }> }) {
  await migrate();
  const { id } = await params;

  return (
    <main className="flex flex-col h-screen bg-stone-50 items-center justify-center">
      <PasswordForm sessionId={id} />
    </main>
  );
}
