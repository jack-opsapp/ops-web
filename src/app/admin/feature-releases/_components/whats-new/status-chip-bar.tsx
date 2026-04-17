"use client";

import { STATUS_OPTIONS } from "./types";

interface StatusChipBarProps {
  currentStatus: string;
  onStatusChange: (status: string) => void;
  disabled?: boolean;
}

export function StatusChipBar({ currentStatus, onStatusChange, disabled }: StatusChipBarProps) {
  return (
    <div className="flex gap-1">
      {STATUS_OPTIONS.map((opt) => {
        const isActive = currentStatus === opt.value;
        return (
          <button
            key={opt.value}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled && !isActive) onStatusChange(opt.value);
            }}
            disabled={disabled || isActive}
            className={`px-2 py-0.5 rounded font-mohave text-micro uppercase tracking-wider transition-colors ${
              isActive
                ? "text-white"
                : "bg-white/[0.04] text-[#6B6B6B] hover:bg-white/[0.08] hover:text-[#A0A0A0]"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            style={isActive ? { backgroundColor: opt.color } : undefined}
            title={opt.label}
          >
            {opt.chip}
          </button>
        );
      })}
    </div>
  );
}
