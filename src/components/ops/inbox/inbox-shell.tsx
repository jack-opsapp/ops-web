"use client";

import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import { useEffect, type ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  DEFAULT_INBOX_LAYOUT,
  LEFT_PCT_BOUNDS,
  RIGHT_PCT_BOUNDS,
  useInboxLayoutStore,
} from "@/stores/inbox-layout-store";

interface InboxShellProps {
  threadList: ReactNode;
  detail: ReactNode;
  contextRail: ReactNode;
  /** Override the user's stored preference. When omitted, the store's
   *  `rightRailOpen` is the source of truth. */
  rightRailOpen?: boolean;
  /** When true, skips the resizable panels wiring and renders the columns at
   *  fixed widths. Used by tests + by static contexts where panel persistence
   *  is unwanted. */
  resizable?: boolean;
  className?: string;
}

export function InboxShell({
  threadList,
  detail,
  contextRail,
  rightRailOpen,
  resizable = true,
  className,
}: InboxShellProps) {
  const { t } = useDictionary("inbox");
  const storedOpen = useInboxLayoutStore((s) => s.rightRailOpen);
  const leftPct = useInboxLayoutStore((s) => s.leftPct);
  const rightPct = useInboxLayoutStore((s) => s.rightPct);
  const setLayout = useInboxLayoutStore((s) => s.setLayout);

  // The explicit prop wins (tests + responsive overrides); otherwise use store.
  const open = rightRailOpen ?? storedOpen;

  // Hydration safety: server-render uses the default; first client effect
  // ensures the layout store's persisted preference takes effect after mount.
  useEffect(() => {
    /* zustand/persist hydration runs automatically; nothing to do here */
  }, []);

  if (!resizable) {
    return (
      <div
        data-inbox-debug-id="A2"
        data-inbox-debug-label="INBOX WORKSPACE"
        className={cn(
          "flex h-full min-h-0 w-full bg-inbox-bg text-text",
          className,
        )}
      >
        <aside
          data-inbox-debug-id="B0"
          data-inbox-debug-label="THREAD COLUMN"
          role="complementary"
          aria-label={t("shell.threadList", "Thread list")}
          className="flex w-[360px] shrink-0 flex-col border-r border-line bg-inbox-bg"
        >
          {threadList}
        </aside>
        <main
          data-inbox-debug-id="C0"
          data-inbox-debug-label="DETAIL COLUMN"
          className="flex min-w-0 flex-1 flex-col bg-inbox-bg"
        >
          {detail}
        </main>
        {open && (
          <aside
            data-inbox-debug-id="D0"
            data-inbox-debug-label="CONTEXT RAIL"
            role="complementary"
            aria-label={t("shell.threadContext", "Thread context")}
            className="flex w-[360px] shrink-0 flex-col border-l border-line bg-inbox-bg-deep"
          >
            {contextRail}
          </aside>
        )}
      </div>
    );
  }

  function handleLayoutChange(layout: Layout) {
    // v4 layout is keyed by panel id with the size as a percentage number.
    const left = layout["inbox-left"];
    const right = layout["inbox-right"];
    if (typeof left === "number" && typeof right === "number") {
      setLayout({ leftPct: left, rightPct: right });
    }
  }

  return (
    <Group
      data-inbox-debug-id="A2"
      data-inbox-debug-label="INBOX WORKSPACE"
      orientation="horizontal"
      onLayoutChange={handleLayoutChange}
      className={cn(
        "flex h-full min-h-0 w-full bg-inbox-bg text-text",
        className,
      )}
    >
      <Panel
        id="inbox-left"
        defaultSize={`${leftPct}%`}
        minSize={`${LEFT_PCT_BOUNDS[0]}%`}
        maxSize={`${LEFT_PCT_BOUNDS[1]}%`}
      >
        <aside
          data-inbox-debug-id="B0"
          data-inbox-debug-label="THREAD COLUMN"
          role="complementary"
          aria-label={t("shell.threadList", "Thread list")}
          className="flex h-full min-h-0 flex-col border-r border-line bg-inbox-bg"
        >
          {threadList}
        </aside>
      </Panel>

      <ResizeHandle
        onDoubleClick={() =>
          setLayout({
            leftPct: DEFAULT_INBOX_LAYOUT.leftPct,
            rightPct: DEFAULT_INBOX_LAYOUT.rightPct,
          })
        }
      />

      <Panel id="inbox-center">
        <main
          data-inbox-debug-id="C0"
          data-inbox-debug-label="DETAIL COLUMN"
          className="flex h-full min-h-0 flex-col bg-inbox-bg"
        >
          {detail}
        </main>
      </Panel>

      {open && (
        <ResizeHandle
          onDoubleClick={() =>
            setLayout({
              leftPct: DEFAULT_INBOX_LAYOUT.leftPct,
              rightPct: DEFAULT_INBOX_LAYOUT.rightPct,
            })
          }
        />
      )}

      {open && (
        <Panel
          id="inbox-right"
          defaultSize={`${rightPct}%`}
          minSize={`${RIGHT_PCT_BOUNDS[0]}%`}
          maxSize={`${RIGHT_PCT_BOUNDS[1]}%`}
        >
          <aside
            data-inbox-debug-id="D0"
            data-inbox-debug-label="CONTEXT RAIL"
            role="complementary"
            aria-label={t("shell.threadContext", "Thread context")}
            className="flex h-full min-h-0 flex-col border-l border-line bg-inbox-bg-deep"
          >
            {contextRail}
          </aside>
        </Panel>
      )}
    </Group>
  );
}

interface ResizeHandleProps {
  onDoubleClick?: () => void;
}

function ResizeHandle({ onDoubleClick }: ResizeHandleProps) {
  const { t } = useDictionary("inbox");
  return (
    <Separator
      onDoubleClick={onDoubleClick}
      className={cn(
        "group relative w-1 shrink-0 cursor-col-resize bg-transparent",
        "transition-colors hover:bg-line-hi",
      )}
      aria-label={t("shell.resizePanel", "Resize panel")}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-line-hi"
      />
    </Separator>
  );
}
