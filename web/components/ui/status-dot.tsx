import { cn } from "@/lib/utils";

export type StatusDotTone = "moss" | "acacia" | "clay" | "stone";

const toneClass: Record<StatusDotTone, string> = {
  moss: "bg-moss-500",
  acacia: "bg-acacia-400",
  clay: "bg-clay-400",
  stone: "bg-stone-300",
};

interface StatusDotProps {
  tone: StatusDotTone;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ tone, pulse, className }: StatusDotProps) {
  return (
    <div
      className={cn(
        "w-2 h-2 rounded-full shrink-0",
        toneClass[tone],
        pulse && "animate-pulse",
        className
      )}
    />
  );
}
