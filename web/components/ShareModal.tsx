"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Check, Trash2, Loader2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Invite {
  email: string;
  role: "viewer" | "editor";
}

interface ShareModalProps {
  sessionId: string;
  onClose: () => void;
}

const LINK_OPTIONS = [
  { value: "private", label: "Only invited people" },
  { value: "view", label: "Anyone with link can view" },
  { value: "edit", label: "Anyone with link can edit" },
] as const;

export function ShareModal({ sessionId, onClose }: ShareModalProps) {
  const [linkAccess, setLinkAccess] = useState<"private" | "view" | "edit">("private");
  const [hasPassword, setHasPassword] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [emailInput, setEmailInput] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/share`)
      .then(r => r.json())
      .then((d: { linkAccess: "private" | "view" | "edit"; hasPassword: boolean; invites: Invite[] }) => {
        setLinkAccess(d.linkAccess);
        setHasPassword(d.hasPassword);
        setPasswordEnabled(d.hasPassword);
        setInvites(d.invites ?? []);
        setLoading(false);
      });
  }, [sessionId]);

  const updateLinkAccess = useCallback(async (newAccess: "private" | "view" | "edit") => {
    setLinkAccess(newAccess);
    await fetch(`/api/sessions/${sessionId}/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkAccess: newAccess }),
    });
  }, [sessionId]);

  const handlePasswordToggle = useCallback(async (enabled: boolean) => {
    setPasswordEnabled(enabled);
    if (!enabled) {
      setPasswordInput("");
      setHasPassword(false);
      await fetch(`/api/sessions/${sessionId}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removePassword: true }),
      });
    }
  }, [sessionId]);

  const handleSetPassword = useCallback(async () => {
    if (!passwordInput.trim()) return;
    await fetch(`/api/sessions/${sessionId}/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput }),
    });
    setHasPassword(true);
    setPasswordSaved(true);
    setPasswordInput("");
    setTimeout(() => setPasswordSaved(false), 2000);
  }, [sessionId, passwordInput]);

  const handleAddInvite = useCallback(async () => {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    setInviting(true);
    await fetch(`/api/sessions/${sessionId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed, role: inviteRole }),
    });
    const normalized = trimmed.toLowerCase();
    setInvites(prev => {
      const exists = prev.find(i => i.email === normalized);
      if (exists) return prev.map(i => i.email === normalized ? { ...i, role: inviteRole } : i);
      return [...prev, { email: normalized, role: inviteRole }];
    });
    setEmailInput("");
    setInviting(false);
  }, [sessionId, emailInput, inviteRole]);

  const handleRemoveInvite = useCallback(async (email: string) => {
    await fetch(`/api/sessions/${sessionId}/invites/${encodeURIComponent(email)}`, { method: "DELETE" });
    setInvites(prev => prev.filter(i => i.email !== email));
  }, [sessionId]);

  const handleCopyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="sm:max-w-[440px] max-h-[85vh] p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center justify-between px-5 py-4 border-b border-stone-200 gap-0 shrink-0">
          <DialogTitle className="text-sm font-semibold text-stone-800">Share session</DialogTitle>
          <DialogClose className="text-stone-400 hover:text-stone-600 transition-colors p-1 rounded">
            <X size={15} />
          </DialogClose>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-10">
            <Loader2 size={20} className="animate-spin text-stone-400" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-stone-100">
            {/* Link access */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Link access</p>
              <div className="space-y-1.5">
                {LINK_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateLinkAccess(opt.value)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      linkAccess === opt.value
                        ? "border-sage-300 bg-sage-50"
                        : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      linkAccess === opt.value ? "border-sage-500" : "border-stone-300"
                    }`}>
                      {linkAccess === opt.value && <div className="w-2 h-2 rounded-full bg-sage-500" />}
                    </div>
                    <span className={`text-xs ${linkAccess === opt.value ? "text-sage-800 font-medium" : "text-stone-700"}`}>
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Password toggle — only when link is not private */}
              {linkAccess !== "private" && (
                <div className="pt-1 space-y-2">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={passwordEnabled}
                      onChange={e => handlePasswordToggle(e.target.checked)}
                      className="w-3.5 h-3.5 accent-sage-600"
                    />
                    <Lock size={12} className="text-stone-400" />
                    <span className="text-xs text-stone-600">Require password</span>
                    {hasPassword && (
                      <span className="text-[10px] text-moss-600 bg-moss-50 border border-moss-200 px-1.5 py-0.5 rounded font-medium">Active</span>
                    )}
                  </label>
                  {passwordEnabled && (
                    <div className="flex gap-2 pl-6">
                      <Input
                        type="password"
                        value={passwordInput}
                        onChange={e => setPasswordInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSetPassword()}
                        placeholder={hasPassword ? "Change password…" : "Set password…"}
                        className="flex-1 text-xs"
                      />
                      <Button
                        size="sm"
                        onClick={handleSetPassword}
                        disabled={!passwordInput.trim()}
                        className="shrink-0 text-xs"
                      >
                        {passwordSaved ? "Saved!" : "Set"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Copy link */}
              <button
                onClick={handleCopyLink}
                className="w-full flex items-center justify-center gap-2 text-xs text-stone-500 hover:text-stone-700 border border-stone-200 hover:border-stone-300 rounded-lg py-2 transition-colors"
              >
                {copied
                  ? <><Check size={13} className="text-moss-500" /> Copied!</>
                  : <><Copy size={13} /> Copy link</>
                }
              </button>
            </div>

            {/* Invite people */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Invite people</p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddInvite()}
                  placeholder="email@example.com"
                  className="flex-1 min-w-0 text-xs"
                />
                <Select
                  value={inviteRole}
                  onValueChange={(val) => { if (val) setInviteRole(val as "viewer" | "editor"); }}
                >
                  <SelectTrigger size="sm" className="shrink-0 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleAddInvite}
                  disabled={!emailInput.trim() || inviting}
                  className="shrink-0"
                >
                  {inviting ? <Loader2 size={12} className="animate-spin" /> : "Invite"}
                </Button>
              </div>

              {invites.length > 0 ? (
                <div className="space-y-1">
                  {invites.map(invite => (
                    <div key={invite.email} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-50">
                      <span className="text-xs text-stone-700 flex-1 truncate">{invite.email}</span>
                      <span className="text-[10px] text-stone-500 bg-white border border-stone-200 px-1.5 py-0.5 rounded shrink-0 capitalize">
                        {invite.role}
                      </span>
                      <button
                        onClick={() => handleRemoveInvite(invite.email)}
                        className="text-stone-300 hover:text-clay-500 transition-colors shrink-0 p-0.5"
                        title="Remove invite"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-stone-400 text-center py-2">No people invited yet</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
