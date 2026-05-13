"use client";

import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Plus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionRow {
  id: string;
  name: string;
  created_at: string;
}

export function LoginGate() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpenId) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [menuOpenId]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSessions(data?.sessions ?? []));
  }, [session]);

  const createSession = useCallback(async () => {
    setCreating(true);
    const res = await fetch("/api/sessions", { method: "POST" });
    if (res.ok) {
      const { id } = await res.json();
      router.push(`/session/${id}`);
    } else {
      setCreating(false);
    }
  }, [router]);

  const startRename = useCallback((s: SessionRow, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingId(s.id);
    setEditDraft(s.name);
    setTimeout(() => editRef.current?.select(), 0);
  }, []);

  const startRenameFromMenu = useCallback((s: SessionRow) => {
    setMenuOpenId(null);
    setEditingId(s.id);
    setEditDraft(s.name);
    setTimeout(() => editRef.current?.select(), 0);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    setMenuOpenId(null);
    setSessions((prev) => (prev ?? []).filter((s) => s.id !== id));
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  }, []);

  const commitRename = useCallback(async (id: string) => {
    const trimmed = editDraft.trim();
    setEditingId(null);
    if (!trimmed) return;
    setSessions((prev) => (prev ?? []).map((s) => s.id === id ? { ...s, name: trimmed } : s));
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
  }, [editDraft]);

  if (status === "loading") {
    return (
      <div className="h-full flex items-center justify-center text-stone-300">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-sage-600 flex items-center justify-center">
            <span className="text-white text-lg font-bold">VS</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-stone-800">Virtual Staging</h1>
            <p className="text-sm text-stone-400">AI-powered interior staging canvas</p>
          </div>
        </div>
        <Button
          onClick={() => signIn("google")}
          className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm px-6 flex items-center gap-3"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h2 className="text-lg font-semibold text-stone-800 mb-6">Sessions</h2>

      {sessions === null ? (
        <div className="flex items-center justify-center py-16 text-stone-300">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={createSession}
            disabled={creating}
            className="group flex items-center gap-3 p-5 rounded-2xl border border-dashed border-stone-300 hover:border-stone-400 hover:bg-stone-50 transition-all text-left"
          >
            {creating ? (
              <Loader2 size={15} className="text-stone-400 animate-spin shrink-0" />
            ) : (
              <Plus size={15} className="text-stone-400 group-hover:text-stone-600 shrink-0" />
            )}
            <span className="text-sm text-stone-400 group-hover:text-stone-600">New Session</span>
          </button>

          {sessions.map((s) => (
            <div
              key={s.id}
              className="group relative flex flex-col justify-between p-5 bg-white rounded-2xl border border-stone-200 hover:border-stone-300 hover:shadow-sm transition-all cursor-pointer"
              onClick={() => {
                if (editingId === s.id) return;
                if (menuOpenId === s.id) { setMenuOpenId(null); return; }
                router.push(`/session/${s.id}`);
              }}
            >
              <button
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-stone-100 transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpenId(menuOpenId === s.id ? null : s.id);
                }}
              >
                <MoreHorizontal size={14} className="text-stone-400" />
              </button>

              {menuOpenId === s.id && (
                <div
                  ref={menuRef}
                  className="absolute top-9 right-3 z-10 bg-white border border-stone-200 rounded-xl shadow-md py-1 min-w-[120px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="w-full text-left px-3 py-2 text-xs text-stone-700 hover:bg-stone-50"
                    onClick={() => startRenameFromMenu(s)}
                  >
                    Rename
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-xs text-clay-600 hover:bg-stone-50"
                    onClick={() => deleteSession(s.id)}
                  >
                    Delete
                  </button>
                </div>
              )}

              {editingId === s.id ? (
                <input
                  ref={editRef}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitRename(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-medium text-stone-800 bg-transparent border-b border-stone-300 outline-none w-full"
                  autoFocus
                />
              ) : (
                <span
                  className="text-sm font-medium text-stone-800 leading-snug"
                  onDoubleClick={(e) => startRename(s, e)}
                  title="Double-click to rename"
                >
                  {s.name}
                </span>
              )}
              <span className="text-xs text-stone-400 mt-3 block">
                {new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
