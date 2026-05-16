"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

export function NewCanvasButton({ className }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      const { id } = await res.json();
      router.push(`/canvas/${id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={[
        "flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 rounded-lg px-3 py-2 transition-colors shadow-sm",
        className ?? "",
      ].join(" ").trim()}
    >
      <Plus size={15} />
      {loading ? "Creating…" : "New canvas"}
    </button>
  );
}
