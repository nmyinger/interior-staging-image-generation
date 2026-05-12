import { StageCanvas } from "@/components/canvas/StageCanvas";

export default function Home() {
  return (
    <main className="flex flex-col h-screen bg-slate-50">
      <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-violet-600 flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VS</span>
          </div>
          <span className="text-sm font-semibold text-slate-800">Virtual Staging</span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span>drag from node handles to connect references</span>
          <span className="inline-block border-t-2 border-dashed border-amber-400 w-6" />
          <span className="text-amber-500">style reference</span>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <StageCanvas />
      </div>
    </main>
  );
}
