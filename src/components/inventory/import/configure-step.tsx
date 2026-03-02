"use client";

import { cn } from "@/lib/utils/cn";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Orientation = "rows" | "columns";
export type Mode = "one-per-row" | "multiple-per-row";

interface ConfigureStepProps {
  orientation: Orientation;
  onOrientationChange: (o: Orientation) => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
}

// ─── Radio-style option button ───────────────────────────────────────────────

function OptionButton({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-3 rounded-md border transition-all duration-150",
        "cursor-pointer",
        selected
          ? "border-ops-accent bg-ops-accent/10"
          : "border-border bg-transparent hover:border-border-strong hover:bg-[rgba(255,255,255,0.02)]"
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0",
            selected ? "border-ops-accent" : "border-text-tertiary"
          )}
        >
          {selected && (
            <div className="h-2 w-2 rounded-full bg-ops-accent" />
          )}
        </div>
        <div>
          <p className="font-mohave text-body text-text-primary">{title}</p>
          <p className="font-mohave text-caption-sm text-text-tertiary mt-0.5">
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConfigureStep({
  orientation,
  onOrientationChange,
  mode,
  onModeChange,
}: ConfigureStepProps) {
  return (
    <div className="flex flex-col gap-6 py-4">
      {/* Orientation */}
      <div className="flex flex-col gap-2">
        <label className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
          Data Orientation
        </label>
        <div className="flex flex-col gap-2">
          <OptionButton
            selected={orientation === "rows"}
            onClick={() => onOrientationChange("rows")}
            title="Items as Rows"
            description="Each row in the CSV represents one inventory item (most common)"
          />
          <OptionButton
            selected={orientation === "columns"}
            onClick={() => onOrientationChange("columns")}
            title="Items as Columns"
            description="Each column in the CSV represents one inventory item"
          />
        </div>
      </div>

      {/* Mode */}
      <div className="flex flex-col gap-2">
        <label className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
          Import Mode
        </label>
        <div className="flex flex-col gap-2">
          <OptionButton
            selected={mode === "one-per-row"}
            onClick={() => onModeChange("one-per-row")}
            title="One Item Per Row"
            description="Standard layout — each row is a single inventory item"
          />
          <OptionButton
            selected={mode === "multiple-per-row"}
            onClick={() => onModeChange("multiple-per-row")}
            title="Multiple Items Per Row"
            description="Bulk layout — rows may contain repeated item groups"
          />
        </div>
      </div>
    </div>
  );
}
