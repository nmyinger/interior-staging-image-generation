"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, ImageIcon } from "lucide-react";

export interface BatchItem {
  id: string;
  status: string;
  staged_url: string | null;
  staged_raw_url: string | null;
  original_url: string | null;
  prompt: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  photo_filename: string;
  zone: string | null;
  room_type: string | null;
  is_hero: boolean;
  position: number;
}

interface BatchData {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  items: BatchItem[];
}

interface BatchProgressProps {
  batchId: string;
  totalPhotos: number;
  onComplete?: (items: BatchItem[]) => void;
}

function statusMessage(data: BatchData): string {
  const total = data.items.length;
  const done = data.items.filter((i) => i.status === "done").length;
  const generating = data.items.filter((i) => i.status === "generating").length;
  const analyzing = data.items.filter((i) => i.status === "analyzing").length;

  if (data.status === "done") return `Complete — ${done}/${total} staged`;
  if (data.status === "failed") return `Failed — ${done}/${total} completed`;
  if (analyzing > 0) return `Analyzing rooms…`;
  if (generating > 0) return `Staging ${done + generating}/${total} rooms…`;
  return `Queued — ${total} photos`;
}

const ITEM_STATUS_DOT: Record<string, string> = {
  queued: "bg-stone-300",
  analyzing: "bg-acacia-400 animate-pulse",
  generating: "bg-sage-500 animate-pulse",
  done: "bg-moss-500",
  failed: "bg-clay-500",
};

export function BatchProgress({ batchId, totalPhotos, onComplete }: BatchProgressProps) {
  const [data, setData] = useState<BatchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const calledComplete = useRef(false);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/batches/${batchId}`);
      if (!res.ok) {
        setError(`Error fetching batch: ${res.status}`);
        stopPolling();
        return;
      }
      const json: BatchData = await res.json();
      setData(json);

      const terminal = json.status === "done" || json.status === "failed";
      if (terminal) {
        stopPolling();
        if (json.status === "done" && !calledComplete.current) {
          calledComplete.current = true;
          onComplete?.(json.items);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Polling failed");
      stopPolling();
    }
  }, [batchId, onComplete, stopPolling]);

  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      poll();
    }
    intervalRef.current = setInterval(poll, 3000);
    return () => stopPolling();
  }, [poll, stopPolling]);

  if (error) {
    return (
      <div className="rounded-xl border border-clay-400/30 bg-clay-400/5 p-4 text-xs text-clay-500 flex items-center gap-2">
        <AlertCircle size={14} />
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 flex items-center gap-2 text-xs text-stone-400">
        <Loader2 size={14} className="animate-spin" />
        Loading batch status…
      </div>
    );
  }

  const done = data.items.filter((i) => i.status === "done").length;
  const total = data.items.length || totalPhotos;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isTerminal = data.status === "done" || data.status === "failed";

  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-3">
        {isTerminal ? (
          data.status === "done" ? (
            <CheckCircle2 size={16} className="text-moss-500 shrink-0" />
          ) : (
            <AlertCircle size={16} className="text-clay-500 shrink-0" />
          )
        ) : (
          <Loader2 size={16} className="text-sage-600 animate-spin shrink-0" />
        )}
        <span className="text-sm font-medium text-stone-800 flex-1">
          {statusMessage(data)}
        </span>
        {!isTerminal && (
          <span className="text-xs text-stone-400 tabular-nums shrink-0">
            {done}/{total}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {!isTerminal && (
        <div className="h-1 bg-stone-100">
          <div
            className="h-full bg-sage-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Error message for failed batch */}
      {data.status === "failed" && data.error && (
        <div className="px-4 py-2 bg-clay-400/5 border-b border-stone-100">
          <p className="text-xs text-clay-500">{data.error}</p>
        </div>
      )}

      {/* Item list */}
      <div className="divide-y divide-stone-50 max-h-72 overflow-y-auto">
        {data.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
            {/* Thumbnail */}
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-100 shrink-0 border border-stone-200">
              {(item.staged_url ?? item.original_url) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(item.staged_url ?? item.original_url)!}
                  alt={item.photo_filename}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon size={16} className="text-stone-300" strokeWidth={1.25} />
                </div>
              )}
            </div>

            {/* Meta */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-stone-700 truncate">
                {item.photo_filename.replace(/^\d+-/, "")}
              </p>
              {(item.room_type || item.zone) && (
                <p className="text-[10px] text-stone-400 truncate">
                  {[item.room_type, item.zone].filter(Boolean).join(" · ")}
                </p>
              )}
              {item.status === "failed" && item.error && (
                <p className="text-[10px] text-clay-500 truncate">{item.error}</p>
              )}
            </div>

            {/* Status dot */}
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${ITEM_STATUS_DOT[item.status] ?? "bg-stone-300"}`}
              title={item.status}
            />

            {/* Download if done */}
            {item.status === "done" && item.staged_url && (
              <button
                onClick={async () => {
                  const res = await fetch(item.staged_url!);
                  const blob = await res.blob();
                  const objectUrl = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = objectUrl;
                  a.download = `staged_${item.photo_filename.replace(/\.[^.]+$/, "")}.jpg`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
                }}
                className="text-[10px] text-sage-600 hover:text-sage-800 shrink-0 border border-sage-200 rounded px-1.5 py-0.5 hover:bg-sage-50 transition-colors"
              >
                Download
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
