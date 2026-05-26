"use client";

import { X } from "lucide-react";
import { useWindowStore } from "@/stores/window-store";

export function WindowDock() {
  const windows = useWindowStore((s) => s.windows);
  const restoreWindow = useWindowStore((s) => s.restoreWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  const minimizedWindows = windows.filter((w) => w.isMinimized);

  if (minimizedWindows.length === 0) return null;

  return (
    <div className="fixed bottom-3 right-3 flex items-center gap-1 z-[96]">
      {minimizedWindows.map((win) => (
        <div
          key={win.id}
          className="flex items-center gap-[6px] px-1.5 py-[6px] rounded-full bg-glass-dense backdrop-blur-xl border border-glass-border cursor-pointer hover:border-glass-border-medium transition-all"
          onClick={() => restoreWindow(win.id)}
        >
          <span className="font-mohave text-[11px] text-text-2 uppercase tracking-wider">
            {win.title}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeWindow(win.id);
            }}
            className="w-[16px] h-[16px] rounded-full flex items-center justify-center text-text-mute hover:text-ops-error transition-colors"
          >
            <X className="w-[10px] h-[10px]" />
          </button>
        </div>
      ))}
    </div>
  );
}
