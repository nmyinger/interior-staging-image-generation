"use client";

import { useSession, signOut } from "next-auth/react";

export function UserMenu() {
  const { data: session } = useSession();
  if (!session?.user) return null;

  const user = session.user;
  return (
    <div className="flex items-center gap-2">
      {user.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.image} alt={user.name ?? ""} className="w-7 h-7 rounded-full" />
      )}
      <span className="text-xs text-slate-600 hidden sm:block">{user.name}</span>
      <button
        onClick={() => signOut()}
        className="text-xs text-slate-400 hover:text-slate-600 ml-1"
      >
        Sign out
      </button>
    </div>
  );
}
