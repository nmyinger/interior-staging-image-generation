import { LoginGate } from "@/components/LoginGate";
import { AppHeader } from "@/components/AppHeader";

export default function Home() {
  return (
    <main className="flex flex-col h-screen bg-stone-50">
      <AppHeader />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LoginGate />
      </div>
    </main>
  );
}
