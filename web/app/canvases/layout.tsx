import { AppSidebar } from "@/components/AppSidebar";

export default function CanvasesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto bg-stone-50">
        {children}
      </main>
    </div>
  );
}
