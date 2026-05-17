"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Settings, Building2, LayoutDashboard, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SignInModal } from "@/components/SignInModal";

export function UserMenu() {
  const { data: session, status } = useSession();
  const [showSignIn, setShowSignIn] = useState(false);

  if (status === "loading") return null;

  if (!session?.user) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setShowSignIn(true)}>
          Log in
        </Button>
        <SignInModal open={showSignIn} onOpenChange={setShowSignIn} />
      </>
    );
  }

  const user = session.user;
  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-full">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt={user.name ?? ""}
            className="w-7 h-7 rounded-full"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center text-xs font-medium text-stone-600">
            {initials}
          </div>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-52">
        {/* User identity — non-interactive header */}
        <div className="px-2 py-2 border-b border-border mb-1">
          <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
          {user.email && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{user.email}</p>
          )}
        </div>

        <DropdownMenuLinkItem href="/">
          <LayoutDashboard size={13} className="text-muted-foreground" />
          Sessions
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem href="/properties">
          <Building2 size={13} className="text-muted-foreground" />
          Properties
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem href="/admin">
          <Settings size={13} className="text-muted-foreground" />
          Admin
        </DropdownMenuLinkItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2 text-muted-foreground"
          onClick={() => signOut()}
        >
          <LogOut size={13} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
