import { LoginGate } from "@/components/LoginGate";
import { UserMenu } from "@/components/UserMenu";

export default function Home() {
  return (
    <main className="flex flex-col h-screen bg-stone-50">
      <header className="h-12 bg-stone-50 border-b border-stone-200 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VS</span>
          </div>
          <span className="text-sm font-semibold text-stone-800">Virtual Staging</span>
        </div>
        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <LoginGate />
      </div>
    </main>
  );
}
