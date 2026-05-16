import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DEMO_CANVAS_ID } from "@/lib/constants";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect("/properties");
  redirect(`/canvas/${DEMO_CANVAS_ID}`);
}
