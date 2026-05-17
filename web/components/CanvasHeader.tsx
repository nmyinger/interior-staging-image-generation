"use client";

import { useState, useRef, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { UserMenu } from "@/components/UserMenu";
import { ShareModal } from "@/components/ShareModal";
import { Button } from "@/components/ui/button";
import { ChevronRight, Share2 } from "lucide-react";

interface CanvasHeaderProps {
  canvasId: string;
  initialName: string;
  ownerUserId: string;
  propertyId?: string | null;
  readOnly?: boolean;
  isDemo?: boolean;
}

export function CanvasHeader({ canvasId, initialName, ownerUserId, propertyId, readOnly, isDemo }: CanvasHeaderProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showShareModal, setShowShareModal] = useState(false);

  const isOwner = (session?.user as { id?: string } | undefined)?.id === ownerUserId;
  const backHref = propertyId ? `/properties/${propertyId}` : "/properties";

  const startEdit = useCallback(() => {
    if (!isOwner) return;
    setDraft(name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [isOwner, name]);

  const commitEdit = useCallback(async () => {
    setEditing(false);
    const trimmed = draft.trim() || name;
    setName(trimmed);
    if (trimmed !== name) {
      // Property canvas: rename via properties API; session canvas: via sessions API
      const endpoint = propertyId && canvasId === propertyId
        ? `/api/properties/${canvasId}`
        : `/api/sessions/${canvasId}`;
      await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
    }
  }, [draft, name, canvasId]);

  return (
    <>
      <header className="h-12 bg-stone-50 border-b border-stone-200 flex items-center px-4 shrink-0 gap-2">
        <button
          onClick={() => router.push(backHref)}
          className="flex items-center gap-1.5 text-stone-400 hover:text-stone-600 transition-colors"
        >
          <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center shrink-0">
            <span className="text-white text-[10px] font-bold">VS</span>
          </div>
          <span className="text-xs text-stone-500 hidden sm:block">
            {propertyId ? "Property" : "Properties"}
          </span>
        </button>

        <ChevronRight size={14} className="text-stone-300 shrink-0" />

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") { setEditing(false); setDraft(name); }
            }}
            className="text-sm font-medium text-stone-800 bg-transparent border-b border-stone-300 outline-none px-0 w-48 min-w-0"
            autoFocus
          />
        ) : (
          <span
            onClick={startEdit}
            className={`text-sm font-medium text-stone-800 truncate ${isOwner ? "cursor-text hover:text-stone-500" : ""}`}
            title={isOwner ? "Click to rename" : name}
          >
            {name}
          </span>
        )}

        {readOnly && (
          <span className="ml-1 text-[10px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded font-medium shrink-0">
            View only
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {/* Share only available on session canvases — property sharing is on the property page */}
          {isOwner && canvasId !== propertyId && (
            <button
              onClick={() => setShowShareModal(true)}
              className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-700 transition-colors"
            >
              <Share2 size={14} />
              <span className="hidden sm:block">Share</span>
            </button>
          )}
          {isDemo ? (
            <Button
              size="sm"
              onClick={() => signIn("google", { callbackUrl: "/properties" })}
              className="bg-sage-600 hover:bg-sage-700 text-white"
            >
              Sign in free
            </Button>
          ) : (
            <UserMenu />
          )}
        </div>
      </header>

      {showShareModal && (
        <ShareModal sessionId={canvasId} onClose={() => setShowShareModal(false)} />
      )}
    </>
  );
}
