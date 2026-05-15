import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SessionsList } from "@/components/SessionsList";

export default async function SessionsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/");
  return <SessionsList />;
}
