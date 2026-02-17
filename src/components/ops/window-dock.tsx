"use client";

import { X } from "lucide-react";
import { useWindowStore } from "@/stores/window-store";

export function WindowDock() {
  const windows = useWindowStore((s) => s.windows);
  const restoreWindow = useWindowStore((s) => s.restoreWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  const minimized = windows.filter((w) => w.isMinimized);
  if (minimized.length === 0) return null;

  return (
    <div className="fixed bottom-3 right-3 flex items-center gap-1 z-[90]">
      {minimized.map((win) => (
        <div
          key={win.id}
          className="flex items-center gap-[6px] px-1.5 py-[6px] rounded-full bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] shadow-floating cursor-pointer hover:border-ops-accent transition-all"
          onClick={() => restoreWindow(win.id)}
        >
          <span className="font-mohave text-[11px] text-text-secondary uppercase tracking-wider">
            {win.title}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeWindow(win.id);
            }}
            className="w-[16px] h-[16px] rounded-full flex items-center justify-center text-text-disabled hover:text-ops-error transition-colors"
          >
            <X className="w-[10px] h-[10px]" />
          </button>
        </div>
      ))}
    </div>
  );
}
