import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignInPage } from "@/components/SignInPage";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect("/properties");
  return <SignInPage />;
}
