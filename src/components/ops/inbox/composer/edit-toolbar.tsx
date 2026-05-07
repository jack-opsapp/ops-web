"use client";

import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface EditToolbarProps {
  added: number;
  removed: number;
  onSeeChanges: () => void;
  onRevert: () => void;
  onRegenerate: () => void;
  className?: string;
}

const ghostBtn =
  "font-mohave text-[11.5px] text-text-2 hover:text-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent rounded-[3px] px-1";

export function EditToolbar({
  added,
  removed,
  onSeeChanges,
  onRevert,
  onRegenerate,
  className,
}: EditToolbarProps) {
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap items-center gap-2 rounded-[4px] border border-dashed border-line bg-white/[0.02] px-2.5 py-1.5",
        className,
      )}
    >
      <Pencil aria-hidden className="h-3 w-3 text-text-3" strokeWidth={1.75} />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-3">
        edited from Claude&apos;s draft
      </span>
      <span
        className="font-mono text-[10.5px] tabular-nums text-olive"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        +{added}
      </span>
      <span
        className="font-mono text-[10.5px] tabular-nums text-rose"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        −{removed}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={onSeeChanges} className={ghostBtn}>
          See changes
        </button>
        <button type="button" onClick={onRevert} className={ghostBtn}>
          Revert
        </button>
        <button type="button" onClick={onRegenerate} className={ghostBtn}>
          Regenerate
        </button>
      </div>
    </div>
  );
}
