"use client";

import { Undo, Eraser, Minus } from "lucide-react";

interface MarkupToolbarProps {
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
}

const COLORS = [
  "#FF0000",
  "#FFD700",
  "#00FF00",
  "#00BFFF",
  "#FF69B4",
  "#FFFFFF",
  "#000000",
];

const STROKE_WIDTHS = [
  { value: 2, label: "Thin" },
  { value: 4, label: "Medium" },
  { value: 8, label: "Thick" },
];

export function MarkupToolbar({
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  onUndo,
  onClear,
  canUndo,
}: MarkupToolbarProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-[#111] px-3 py-2">
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            className={`h-6 w-6 rounded-full border-2 transition ${
              color === c ? "border-white scale-110" : "border-transparent"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="h-6 w-px bg-white/10" />

      <div className="flex items-center gap-1.5">
        {STROKE_WIDTHS.map((sw) => (
          <button
            key={sw.value}
            onClick={() => onStrokeWidthChange(sw.value)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
              strokeWidth === sw.value
                ? "bg-[#417394]/30 text-[#8BB8D4]"
                : "text-[#999] hover:text-[#E5E5E5]"
            }`}
          >
            <Minus
              className="h-3 w-3"
              style={{ strokeWidth: sw.value }}
            />
            {sw.label}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-white/10" />

      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="rounded p-1.5 text-[#999] transition hover:bg-white/10 hover:text-[#E5E5E5] disabled:opacity-30"
        title="Undo"
      >
        <Undo className="h-4 w-4" />
      </button>
      <button
        onClick={onClear}
        disabled={!canUndo}
        className="rounded p-1.5 text-[#999] transition hover:bg-white/10 hover:text-[#E5E5E5] disabled:opacity-30"
        title="Clear all"
      >
        <Eraser className="h-4 w-4" />
      </button>
    </div>
  );
}
