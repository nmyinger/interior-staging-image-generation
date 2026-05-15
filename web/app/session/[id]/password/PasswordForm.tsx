"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Loader2 } from "lucide-react";

export function PasswordForm({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/sessions/${sessionId}/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push(`/session/${sessionId}`);
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Incorrect password");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-[340px] bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden">
      <div className="px-6 py-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-stone-100 flex items-center justify-center shrink-0">
            <Lock size={16} className="text-stone-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-800">Password required</p>
            <p className="text-xs text-stone-500">Enter the password to view this session</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
          />
          {error && <p className="text-xs text-clay-500">{error}</p>}
          <Button
            type="submit"
            disabled={!password || loading}
            className="w-full text-white bg-sage-600 hover:bg-sage-700"
          >
            {loading && <Loader2 size={13} className="animate-spin mr-1.5" />}
            Continue
          </Button>
        </form>
      </div>
    </div>
  );
}
