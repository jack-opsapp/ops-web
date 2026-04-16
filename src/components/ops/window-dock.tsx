"use client";

import { X } from "lucide-react";
import { useWindowStore } from "@/stores/window-store";
import { useDetailPopoverStore } from "@/app/(dashboard)/pipeline/_components/detail-popover-store";

export function WindowDock() {
  const windows = useWindowStore((s) => s.windows);
  const restoreWindow = useWindowStore((s) => s.restoreWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  const popovers = useDetailPopoverStore((s) => s.popovers);
  const restorePopover = useDetailPopoverStore((s) => s.restorePopover);
  const closePopover = useDetailPopoverStore((s) => s.closePopover);

  const minimizedWindows = windows.filter((w) => w.isMinimized);
  const minimizedPopovers = Array.from(popovers.values()).filter((p) => p.isMinimized);

  if (minimizedWindows.length === 0 && minimizedPopovers.length === 0) return null;

  return (
    <div className="fixed bottom-3 right-3 flex items-center gap-1 z-[96]">
      {minimizedWindows.map((win) => (
        <div
          key={win.id}
          className="flex items-center gap-[6px] px-1.5 py-[6px] rounded-full bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] shadow-floating cursor-pointer hover:border-ops-accent transition-all"
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

      {minimizedPopovers.map((p) => (
        <div
          key={`popover-${p.id}`}
          className="flex items-center gap-[6px] px-1.5 py-[6px] rounded-full bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] shadow-floating cursor-pointer hover:border-ops-accent transition-all"
          onClick={() => restorePopover(p.id)}
        >
          <div
            className="w-[6px] h-[6px] rounded-[2px] shrink-0"
            style={{ backgroundColor: p.stageColor ?? "#597794" }}
          />
          <span className="font-mohave text-[11px] text-text-2 uppercase tracking-wider truncate max-w-[120px]">
            {p.title}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closePopover(p.id);
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
