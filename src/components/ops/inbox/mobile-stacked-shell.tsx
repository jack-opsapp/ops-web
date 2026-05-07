"use client";

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export type MobileInboxPane = "list" | "detail" | "context";

interface MobileStackedShellProps {
  activePane: MobileInboxPane;
  onPaneChange: (pane: MobileInboxPane) => void;
  threadList: ReactNode;
  detail: ReactNode;
  contextRail: ReactNode;
  className?: string;
}

const BACK_TARGET: Record<MobileInboxPane, MobileInboxPane> = {
  list: "list",
  detail: "list",
  context: "detail",
};

export function MobileStackedShell({
  activePane,
  onPaneChange,
  threadList,
  detail,
  contextRail,
  className,
}: MobileStackedShellProps) {
  const { t } = useDictionary("inbox");
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col bg-inbox-bg text-text",
        className,
      )}
    >
      {activePane !== "list" && (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-inbox-panel px-3">
          <button
            type="button"
            onClick={() => onPaneChange(BACK_TARGET[activePane])}
            aria-label={t("mobile.back", "Back")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-chip text-text-2 hover:bg-inbox-elev hover:text-text"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <span className="font-cakemono text-[10px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
            {activePane === "detail"
              ? t("mobile.thread", "// THREAD")
              : t("mobile.context", "// CONTEXT")}
          </span>
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {activePane === "list" && threadList}
        {activePane === "detail" && detail}
        {activePane === "context" && contextRail}
      </div>
    </div>
  );
}
