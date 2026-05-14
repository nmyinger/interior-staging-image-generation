"use client";

import { Loader2, CheckCircle2, AlertCircle, Clock, FileText, Zap } from "lucide-react";

export type PropertyStatus =
  | "draft"
  | "queued"
  | "analyzing"
  | "generating"
  | "done"
  | "failed";

interface StatusBadgeProps {
  status: PropertyStatus;
  className?: string;
}

const STATUS_CONFIG: Record<
  PropertyStatus,
  { label: string; classes: string; icon: React.ReactNode }
> = {
  draft: {
    label: "Draft",
    classes: "bg-stone-100 text-stone-500 border-stone-200",
    icon: <FileText size={11} />,
  },
  queued: {
    label: "Queued",
    classes: "bg-acacia-100 text-acacia-500 border-acacia-200",
    icon: <Clock size={11} />,
  },
  analyzing: {
    label: "Analyzing",
    classes: "bg-acacia-100 text-acacia-500 border-acacia-200 animate-pulse",
    icon: <Loader2 size={11} className="animate-spin" />,
  },
  generating: {
    label: "Generating",
    classes: "bg-sage-100 text-sage-600 border-sage-200 animate-pulse",
    icon: <Zap size={11} />,
  },
  done: {
    label: "Done",
    classes: "bg-moss-500/10 text-moss-500 border-moss-500/20",
    icon: <CheckCircle2 size={11} />,
  },
  failed: {
    label: "Failed",
    classes: "bg-clay-400/10 text-clay-500 border-clay-400/20",
    icon: <AlertCircle size={11} />,
  },
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${config.classes} ${className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}
