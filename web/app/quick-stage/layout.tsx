import { AppSidebar } from "@/components/AppSidebar";

export default function QuickStageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
