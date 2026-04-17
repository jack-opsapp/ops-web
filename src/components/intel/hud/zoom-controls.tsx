"use client";

// ---------------------------------------------------------------------------
// ZoomControls — frosted-glass zoom buttons in the bottom-right HUD position.
// +/- buttons zoom the camera, reset button returns to default view.
// ---------------------------------------------------------------------------

import { Plus, Minus, Crosshair } from "lucide-react";

interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function ZoomControls({ onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  const buttonClass =
    "w-8 h-8 flex items-center justify-center text-[#999] hover:text-white transition-colors";

  return (
    <div
      className="flex flex-col"
      style={{
        background: "var(--surface-glass)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "3px",
      }}
    >
      <button onClick={onZoomIn} className={buttonClass} title="Zoom in">
        <Plus className="w-3.5 h-3.5" />
      </button>
      <div className="h-px bg-white/5" />
      <button onClick={onZoomOut} className={buttonClass} title="Zoom out">
        <Minus className="w-3.5 h-3.5" />
      </button>
      <div className="h-px bg-white/5" />
      <button onClick={onReset} className={buttonClass} title="Reset view">
        <Crosshair className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
