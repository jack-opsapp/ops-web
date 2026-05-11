"use client";

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "@/components/ops/inbox/voice/slash-label";

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
  const paneLabel =
    activePane === "list"
      ? t("mobile.listPane", "// LIST")
      : activePane === "detail"
        ? t("mobile.threadPane", "// THREAD")
        : t("mobile.contextPane", "// CONTEXT");
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col bg-inbox-bg text-text",
        className,
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-inbox-panel px-3">
        {activePane !== "list" && (
          <button
            type="button"
            onClick={() => onPaneChange(BACK_TARGET[activePane])}
            aria-label={t("mobile.back", "Back")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-chip text-text-2 hover:bg-inbox-elev hover:text-text"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}
        <SlashLabel label={paneLabel} tone="text-2" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {activePane === "list" && threadList}
        {activePane === "detail" && detail}
        {activePane === "context" && contextRail}
      </div>
    </div>
  );
}
