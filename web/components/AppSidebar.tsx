"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Building2,
  Layers,
  ShieldCheck,
  CreditCard,
  Users,
  Settings,
  KeyRound,
  LogOut,
  Wand2,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

const WORKSPACE_NAV: NavItem[] = [
  { href: "/quick-stage", label: "Quick Stage", icon: Wand2 },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "/canvases", label: "Canvases", icon: Layers },
];

const ACCOUNT_NAV: NavItem[] = [
  { href: "/admin/compliance", label: "Compliance", icon: ShieldCheck },
  { href: "/admin/billing", label: "Billing", icon: CreditCard },
  { href: "/admin/team", label: "Team", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/api-keys", label: "API Keys", icon: KeyRound },
];

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

  return (
    <Link
      href={item.href}
      className={[
        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
        isActive
          ? "bg-sage-50 text-sage-700 font-medium"
          : "text-stone-600 hover:bg-stone-100 hover:text-stone-800",
      ].join(" ")}
    >
      <item.icon size={15} className="shrink-0" />
      {item.label}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const user = session?.user;

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "?";

  return (
    <aside className="flex flex-col h-full w-56 bg-white border-r border-stone-200 shrink-0">
      {/* Logo */}
      <div className="h-12 flex items-center px-4 border-b border-stone-200 shrink-0">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VS</span>
          </div>
          <span className="text-sm font-semibold text-stone-800">Virtual Staging</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
        {/* Workspace */}
        <div>
          <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide px-3 mb-1">
            Workspace
          </p>
          <div className="space-y-0.5">
            {WORKSPACE_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        </div>

        {/* Account */}
        <div>
          <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide px-3 mb-1">
            Account
          </p>
          <div className="space-y-0.5">
            {ACCOUNT_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        </div>
      </nav>

      {/* User footer */}
      <div className="border-t border-stone-200 p-3 shrink-0">
        <div className="flex items-center gap-2.5">
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt={user.name ?? ""} className="w-7 h-7 rounded-full shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center text-xs font-medium text-stone-600 shrink-0">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {user?.name && (
              <p className="text-xs font-medium text-stone-700 truncate">{user.name}</p>
            )}
            {user?.email && (
              <p className="text-[11px] text-stone-400 truncate">{user.email}</p>
            )}
          </div>
          <button
            onClick={() => signOut()}
            className="shrink-0 text-stone-400 hover:text-stone-600 transition-colors"
            title="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
