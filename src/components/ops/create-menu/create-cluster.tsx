"use client";

/**
 * CreateCluster — the right-edge create + bug affordance (WEB OVERHAUL P4-5).
 *
 * Edge-reveal, not a floating button. At rest only a 3px nub shows on the right
 * edge; bringing the cursor to the edge fades in a tall tapered glow (the app's
 * own background colour) and slides in two borderless icon-only controls,
 * vertically centred:
 *
 *   • CREATE — a bare Plus glyph (steel accent on hover/active, the screen's one
 *              accent moment). Click or `Q` opens the Create wheel: an iOS drum
 *              picker of the permission-gated actions over a full-height frosted
 *              wash, each action firing by keycap.
 *   • bug    — a smaller, dimmer Bug glyph. Click or `` ` `` screenshots the
 *              screen and opens the bug-report drawer. Rare utility = quiet.
 *
 * Open state runs through the shared `useEdgeTabStore` mutex (ids
 * "quick-actions" / "bug-report"); the wheel owns its own outside-click + key
 * dismissal. Reveal is driven by a passive window pointermove (no DOM hover
 * trap, so page content stays fully clickable). Everything carries
 * `data-bug-report-ignore` so it is excluded from bug screenshots.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Bug } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

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
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { FABAction } from "@/lib/constants/fab-actions";
import { CreateWheel } from "./create-wheel";

const ID_CREATE = "quick-actions";
const ID_BUG = "bug-report";

// Reveal when the cursor is within this many px of the right edge; retract once
// it moves left of (edge − RETRACT). The gap (hysteresis) prevents flicker.
const REVEAL_EDGE = 28;
const RETRACT_AT = 230;

export function CreateCluster() {
  const { t } = useDictionary("quick-actions");
  const { t: tCommon } = useDictionary("common");
  const router = useRouter();
  const reducedMotion = !!useReducedMotion();

  const visible = useQuickActionsVisible();
  const actions = useQuickActions();

  const activeTab = useEdgeTabStore((s) => s.activeTab);
  const toggle = useEdgeTabStore((s) => s.toggle);
  const close = useEdgeTabStore((s) => s.close);
  const createOpen = activeTab === ID_CREATE;
  const bugOpen = activeTab === ID_BUG;

  const [revealed, setRevealed] = useState(false);
  const shown = revealed || createOpen || bugOpen;

  const openWindow = useWindowStore((s) => s.openWindow);
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);
  const openClientWindow = useWindowStore((s) => s.openClientWindow);

  // ── Setup gate (ported from the retired QuickActionsDrawer) ──
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
    [close, gatedAction, router, openWindow, openProjectWindow, openClientWindow, t],
  );

  const handleCustomize = useCallback(() => {
    close(ID_CREATE);
    router.push("/settings?tab=quick-actions");
  }, [close, router]);

  const openBug = useCallback(() => {
    // Capture the screen BEFORE the drawer mounts (the image reflects what the
    // operator was looking at).
    if (useEdgeTabStore.getState().activeTab !== ID_BUG) {
      useBugReportStore.getState().requestScreenshot();
    }
    toggle(ID_BUG);
  }, [toggle]);

  // ── Reveal: passive pointer proximity to the right edge (no hover trap). ──
  useEffect(() => {
    if (!visible) return;
    function onMove(e: PointerEvent) {
      if (useEdgeTabStore.getState().activeTab) {
        setRevealed(true);
        return;
      }
      const x = e.clientX;
      const w = window.innerWidth;
      if (x >= w - REVEAL_EDGE) setRevealed(true);
      else if (x < w - RETRACT_AT) setRevealed(false);
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [visible]);

  // ── Keyboard: Q opens Create, ` opens Bug (ignored while typing). ──
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

  const slideX = reducedMotion ? 0 : shown ? 0 : 48;

  return (
    <>
      {/* Rest nub */}
      <motion.div
        aria-hidden
        data-bug-report-ignore="true"
        className="pointer-events-none fixed right-0 top-1/2 z-[1539] h-[54px] w-[3px] -translate-y-1/2 rounded-l-bar bg-white/15"
        animate={{ opacity: shown ? 0 : 1 }}
        transition={{ duration: 0.25, ease: EASE_SMOOTH }}
      />

      {/* Hover glow — tall, tapered, app background colour (no blur, so it stays
          buttery while it fades). */}
      <motion.div
        aria-hidden
        data-bug-report-ignore="true"
        className="pointer-events-none fixed right-0 top-1/2 z-[1540] h-[360px] w-[170px] -translate-y-1/2"
        style={{
          background:
            "radial-gradient(100% 64% at 100% 50%, rgba(18,18,20,0.94), rgba(17,17,19,0.4) 48%, rgba(8,8,10,0) 82%)",
          WebkitMaskImage:
            "radial-gradient(100% 64% at 100% 50%, #000 28%, transparent 86%)",
          maskImage:
            "radial-gradient(100% 64% at 100% 50%, #000 28%, transparent 86%)",
        }}
        animate={{ opacity: shown && !createOpen && !bugOpen ? 1 : 0 }}
        transition={{ duration: 0.3, ease: EASE_SMOOTH }}
      />

      {/* Icon-only controls */}
      <div
        data-bug-report-ignore="true"
        className="fixed right-[18px] top-1/2 z-[1560] flex -translate-y-1/2 flex-col items-center gap-[18px]"
      >
        <motion.button
          type="button"
          aria-label={t("trigger.ariaLabel")}
          aria-pressed={createOpen}
          onClick={() => toggle(ID_CREATE)}
          onFocus={() => setRevealed(true)}
          initial={false}
          animate={{ x: slideX, opacity: shown ? 1 : 0 }}
          transition={{ duration: reducedMotion ? 0.15 : 0.4, ease: EASE_SMOOTH }}
          style={{ pointerEvents: shown ? "auto" : "none" }}
          className={`flex h-[42px] w-[42px] cursor-pointer items-center justify-center bg-transparent outline-none transition-colors duration-150 ${
            createOpen ? "text-ops-accent" : "text-text hover:text-ops-accent"
          }`}
        >
          <Plus
            className="h-[26px] w-[26px]"
            strokeWidth={1.75}
            aria-hidden
            style={{
              transform: createOpen ? "rotate(45deg)" : "none",
              transition: reducedMotion
                ? "none"
                : "transform 200ms var(--ease-smooth)",
            }}
          />
        </motion.button>

        <motion.button
          type="button"
          aria-label={tCommon("bugReport.title")}
          aria-pressed={bugOpen}
          onClick={openBug}
          onFocus={() => setRevealed(true)}
          initial={false}
          animate={{ x: slideX, opacity: shown ? 1 : 0 }}
          transition={{
            duration: reducedMotion ? 0.15 : 0.4,
            ease: EASE_SMOOTH,
            delay: reducedMotion ? 0 : 0.05,
          }}
          style={{ pointerEvents: shown ? "auto" : "none" }}
          className={`flex h-[30px] w-[30px] cursor-pointer items-center justify-center bg-transparent outline-none transition-colors duration-150 ${
            bugOpen ? "text-text-2" : "text-text-mute hover:text-text-2"
          }`}
        >
          <Bug className="h-[17px] w-[17px]" strokeWidth={1.5} aria-hidden />
        </motion.button>
      </div>

      {/* Create wheel */}
      <AnimatePresence>
        {createOpen && (
          <CreateWheel
            actions={actions}
            t={t}
            onRun={handleRun}
            onCustomize={handleCustomize}
            onClose={() => close(ID_CREATE)}
            reducedMotion={reducedMotion}
          />
        )}
      </AnimatePresence>

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
