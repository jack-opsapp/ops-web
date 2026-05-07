"use client";

import { cn } from "@/lib/utils/cn";

export type ProjectStatus =
  | "On site"
  | "Quoted"
  | "Awaiting acceptance"
  | "Done"
  | "Paid"
  | "Scheduled";

export type StatusPipColor = "ops-accent" | "tan" | "olive" | "text-mute";

export function statusPipColor(status: ProjectStatus): StatusPipColor {
  switch (status) {
    case "On site":
      return "ops-accent";
    case "Awaiting acceptance":
      return "tan";
    case "Done":
    case "Paid":
      return "olive";
    case "Quoted":
    case "Scheduled":
      return "text-mute";
  }
}

const COLOR_BG: Record<StatusPipColor, string> = {
  "ops-accent": "bg-ops-accent",
  tan: "bg-tan",
  olive: "bg-olive",
  "text-mute": "bg-text-mute",
};

interface StatusPipProps {
  status: ProjectStatus;
  className?: string;
}

export function StatusPip({ status, className }: StatusPipProps) {
  const color = statusPipColor(status);
  return (
    <span
      data-testid="status-pip"
      aria-label={status}
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        COLOR_BG[color],
        className,
      )}
    />
  );
}
