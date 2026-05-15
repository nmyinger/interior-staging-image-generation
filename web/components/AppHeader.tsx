import Link from "next/link";
import { UserMenu } from "@/components/UserMenu";

interface AppHeaderProps {
  /** Breadcrumb items after the logo. Pass <span> or <Link> nodes. */
  breadcrumb?: React.ReactNode;
  /** Content to render on the right side before the UserMenu. */
  actions?: React.ReactNode;
}

export function AppHeader({ breadcrumb, actions }: AppHeaderProps) {
  return (
    <header className="h-12 bg-stone-50 border-b border-stone-200 flex items-center px-4 shrink-0 sticky top-0 z-10">
      <div className="flex items-center gap-2 min-w-0">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VS</span>
          </div>
          <span className="text-sm font-semibold text-stone-800">Virtual Staging</span>
        </Link>
        {breadcrumb && (
          <>
            <span className="text-stone-300 mx-0.5">/</span>
            {breadcrumb}
          </>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {actions}
        <UserMenu />
      </div>
    </header>
  );
}
