"use client";

/**
 * CreateCluster — the bottom-right action cluster (WEB OVERHAUL P5).
 *
 * Replaces the right-edge Quick Actions + Bug Report tabs. Two controls,
 * deliberately unequal in weight so prominence tracks frequency:
 *
 *   • CREATE  — the single steel-blue accent element on the screen. Click or
 *               `Q` opens the compact `// CREATE` popover (the real 9 quick
 *               actions). The most frequent action = the brightest pixel.
 *   • bug     — a dim, monochrome glyph. Click or `` ` `` captures a screenshot
 *               of the current screen, then opens the bug-report drawer. Rare
 *               utility = quiet. Also reachable from the ⌘K palette.
 *
 * Open state runs through the shared `useEdgeTabStore` mutex (ids
 * "quick-actions" / "bug-report"), so only one bottom-right surface is open at
 * a time and opening one closes the other. Radix Popover owns the create
 * menu's outside-click + Escape dismissal (the old EdgeTabOutsideDismiss was
 * never mounted). The whole cluster carries `data-bug-report-ignore` so it is
 * excluded from bug screenshots.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Bug } from "lucide-react";
import { useReducedMotion } from "framer-motion";

import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useBugReportStore } from "@/stores/bug-report-store";
import { useWindowStore } from "@/stores/window-store";
import {
  useQuickActions,
  useQuickActionsVisible,
} from "@/lib/hooks/use-quick-actions";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { dispatchQuickAction } from "@/lib/quick-actions/dispatch";
import { useDictionary } from "@/i18n/client";
import type { FABAction } from "@/lib/constants/fab-actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreateMenu } from "./create-menu";

const ID_CREATE = "quick-actions";
const ID_BUG = "bug-report";

export function CreateCluster() {
  const { t } = useDictionary("quick-actions");
  const { t: tCommon } = useDictionary("common");
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const visible = useQuickActionsVisible();
  const actions = useQuickActions();

  const activeTab = useEdgeTabStore((s) => s.activeTab);
  const setActive = useEdgeTabStore((s) => s.setActive);
  const toggle = useEdgeTabStore((s) => s.toggle);
  const close = useEdgeTabStore((s) => s.close);
  const createOpen = activeTab === ID_CREATE;

  const openWindow = useWindowStore((s) => s.openWindow);
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);
  const openClientWindow = useWindowStore((s) => s.openClientWindow);

  // ── Setup gate (ported from the retired QuickActionsDrawer) ──
  // Lives here, not in CreateMenu, so the interception modal survives the
  // popover closing.
  const { isComplete, missingSteps } = useSetupGate();
  const [showInterception, setShowInterception] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [triggerAction, setTriggerActionState] = useState("projects");

  const gatedAction = useCallback(
    (run: () => void, triggerName: string) => {
      if (!isComplete) {
        setPendingAction(() => run);
        setTriggerActionState(triggerName);
        setShowInterception(true);
        return;
      }
      run();
    },
    [isComplete],
  );

  const handleRun = useCallback(
    (action: FABAction) => {
      // Close the menu first so a gated action reveals the interception modal
      // cleanly; then run (or queue behind the gate).
      close(ID_CREATE);
      gatedAction(
        () =>
          dispatchQuickAction(action, {
            router,
            openWindow,
            openProjectWindow,
            openClientWindow,
            t,
          }),
        action.triggerAction,
      );
    },
    [
      close,
      gatedAction,
      router,
      openWindow,
      openProjectWindow,
      openClientWindow,
      t,
    ],
  );

  const handleCustomize = useCallback(() => {
    close(ID_CREATE);
    router.push("/settings?tab=quick-actions");
  }, [close, router]);

  const openBug = useCallback(() => {
    // Capture the screen BEFORE the drawer mounts (matches legacy behavior —
    // the image reflects what the operator was looking at).
    if (activeTab !== ID_BUG) {
      useBugReportStore.getState().requestScreenshot();
    }
    toggle(ID_BUG);
  }, [activeTab, toggle]);

  // ── Keyboard: Q opens Create, ` opens Bug — re-homed from the deleted tabs,
  // same guards (ignore when typing in a field). ──
  useEffect(() => {
    if (!visible) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (!e.shiftKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        toggle(ID_CREATE);
      } else if (e.key === "`") {
        e.preventDefault();
        if (useEdgeTabStore.getState().activeTab !== ID_BUG) {
          useBugReportStore.getState().requestScreenshot();
        }
        toggle(ID_BUG);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, toggle]);

  if (!visible) return null;

  return (
    <>
      <TooltipProvider delayDuration={250}>
        <div
          data-bug-report-ignore="true"
          className="fixed bottom-4 right-4 z-[1500] flex items-center gap-2"
        >
          {/* Bug — dim, subordinate */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={tCommon("bugReport.title")}
                aria-pressed={activeTab === ID_BUG}
                onClick={openBug}
                className="flex h-[32px] w-[32px] cursor-pointer items-center justify-center rounded border border-[var(--line)] bg-[var(--surface-input)] text-text-mute transition-colors duration-150 hover:border-[var(--glass-border-active)] hover:text-text-2 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98]"
              >
                <Bug className="h-[15px] w-[15px]" strokeWidth={1.5} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8}>
              <span className="flex items-center gap-2">
                {tCommon("bugReport.title")}
                <span className="rounded-sm border border-border-subtle bg-fill-neutral-dim px-1 font-mono text-[10px] text-text-2">
                  {"`"}
                </span>
              </span>
            </TooltipContent>
          </Tooltip>

          {/* Create — the one accent element */}
          <Popover
            open={createOpen}
            onOpenChange={(next) =>
              next ? setActive(ID_CREATE) : close(ID_CREATE)
            }
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("trigger.ariaLabel")}
                    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded border border-ops-accent bg-ops-accent text-black transition-colors duration-150 hover:bg-ops-accent-hover focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98]"
                  >
                    <Plus
                      className="h-[22px] w-[22px]"
                      strokeWidth={2}
                      aria-hidden
                      style={{
                        transform: createOpen ? "rotate(45deg)" : "none",
                        transition: reducedMotion
                          ? "none"
                          : "transform 150ms var(--ease-smooth)",
                      }}
                    />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              {!createOpen && (
                <TooltipContent side="left" sideOffset={8}>
                  <span className="flex items-center gap-2">
                    {t("trigger.tooltip")}
                    <span className="rounded-sm border border-border-subtle bg-fill-neutral-dim px-1 font-mono text-[10px] text-text-2">
                      {t("tab.shortcut")}
                    </span>
                  </span>
                </TooltipContent>
              )}
            </Tooltip>

            <PopoverContent
              side="top"
              align="end"
              sideOffset={12}
              className="w-[260px] overflow-hidden border border-[var(--glass-border)] p-0"
              style={{ zIndex: 1560, borderRadius: 12 }}
            >
              <CreateMenu
                actions={actions}
                t={t}
                onRun={handleRun}
                onCustomize={handleCustomize}
              />
            </PopoverContent>
          </Popover>
        </div>
      </TooltipProvider>

      <SetupInterceptionModal
        isOpen={showInterception}
        onComplete={() => {
          setShowInterception(false);
          pendingAction?.();
          setPendingAction(null);
        }}
        onDismiss={() => {
          setShowInterception(false);
          setPendingAction(null);
        }}
        missingSteps={missingSteps}
        triggerAction={triggerAction}
      />
    </>
  );
}
