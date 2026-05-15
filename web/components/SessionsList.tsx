"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Plus, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface SessionRow {
  id: string;
  name: string;
  created_at: string;
}

export function SessionsList() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSessions(data?.sessions ?? []));
  }, []);

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

  const deleteSession = useCallback(async (id: string) => {
    setSessions((prev) => (prev ?? []).filter((s) => s.id !== id));
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  }, []);

  const commitRename = useCallback(async (id: string, draft: string) => {
    const trimmed = draft.trim();
    setEditingId(null);
    if (!trimmed) return;
    setSessions((prev) => (prev ?? []).map((s) => s.id === id ? { ...s, name: trimmed } : s));
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Sessions</h1>
          <p className="text-xs text-stone-400 mt-0.5">Canvas workspaces for interactive staging</p>
        </div>
        <button
          onClick={createSession}
          disabled={creating}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 disabled:bg-sage-300 rounded-lg px-3 py-2 transition-colors shadow-sm"
        >
          {creating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={15} />
          )}
          New session
        </button>
      </div>

      {sessions === null ? (
        <div className="flex items-center justify-center py-24 text-stone-300">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-stone-400">
          <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center">
            <Plus size={22} strokeWidth={1.25} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-stone-600">No sessions yet</p>
            <p className="text-xs text-stone-400 mt-1">Create a session to start staging images</p>
          </div>
          <button
            onClick={createSession}
            disabled={creating}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-lg px-4 py-2 transition-colors shadow-sm mt-2"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}
            New session
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={createSession}
            disabled={creating}
            className="group flex items-center gap-3 p-5 rounded-xl border border-dashed border-stone-300 hover:border-stone-400 hover:bg-stone-50 transition-all text-left"
          >
            {creating ? (
              <Loader2 size={15} className="text-stone-400 animate-spin shrink-0" />
            ) : (
              <Plus size={15} className="text-stone-400 group-hover:text-stone-600 shrink-0" />
            )}
            <span className="text-sm text-stone-400 group-hover:text-stone-600">New session</span>
          </button>

          {sessions.map((s) => (
            <div
              key={s.id}
              className="group relative flex flex-col justify-between p-5 bg-white rounded-xl border border-stone-200 hover:border-stone-300 hover:shadow-sm transition-all cursor-pointer"
              onClick={() => {
                if (editingId === s.id) return;
                router.push(`/session/${s.id}`);
              }}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-stone-100 transition-all outline-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal size={14} className="text-stone-400" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={4} onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => {
                    setEditingId(s.id);
                    setEditDraft(s.name);
                    setTimeout(() => editRef.current?.select(), 0);
                  }}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => deleteSession(s.id)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {editingId === s.id ? (
                <input
                  ref={editRef}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitRename(s.id, editDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.id, editDraft);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-medium text-stone-800 bg-transparent border-b border-stone-300 outline-none w-full"
                  autoFocus
                />
              ) : (
                <span
                  className="text-sm font-medium text-stone-800 leading-snug"
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingId(s.id); setEditDraft(s.name); }}
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
