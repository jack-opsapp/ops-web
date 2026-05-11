"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useDictionary } from "@/i18n/client";
import {
  useQuickActions,
  useQuickActionsVisible,
} from "@/lib/hooks/use-quick-actions";
import { useWindowStore } from "@/stores/window-store";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import {
  isWindowAction,
  resolveActionLabel,
  type FABAction,
} from "@/lib/constants/fab-actions";
import {
  quickActionsDrawerVariants,
  quickActionsDrawerVariantsReduced,
  quickActionsRowVariants,
  quickActionsRowVariantsReduced,
} from "@/lib/utils/motion";
import { computeQuickActionsPanelHeight } from "./quick-actions-tab";

const EDGE_TAB_ID = "quick-actions";

// Panel sizing — width still 308px per Spec V1, but height now scales with
// the visible action count (bug dd5659ed). Use the shared computation from
// quick-actions-tab.tsx so the tab and panel stay aligned. The hard cap
// (QA_MAX_PANEL_H = 452) preserves the original spec for users with long
// custom action lists.
const PANEL_W = 308;
const STACK_OFFSET_QA = 94;
const RAIL_TOP = 72;
const RAIL_BOTTOM = 16;

export function QuickActionsDrawer() {
  const { t } = useDictionary("quick-actions");
  const router = useRouter();
  const visible = useQuickActionsVisible();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const close = useEdgeTabStore((s) => s.close);
  const openWindow = useWindowStore((s) => s.openWindow);
  // Phase 9.2 — project-workspace dispatch goes through the dedicated
  // openProjectWindow helper (centralised id derivation + meta packaging).
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);
  const reducedMotion = useReducedMotion();
  const actions = useQuickActions();
  const PANEL_H = computeQuickActionsPanelHeight(actions.length);

  // Setup gate — reused from the deleted FAB component
  const { isComplete, missingSteps } = useSetupGate();
  const [showInterception, setShowInterception] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [triggerAction, setTriggerActionState] = useState("projects");

  // Drawer ref — used by the outside-click listener to ignore clicks
  // landing inside the panel body. (Bug 5b653c30.)
  const drawerRef = useRef<HTMLElement>(null);

  // Escape closes the drawer
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(EDGE_TAB_ID);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Outside-click dismiss (bug 5b653c30). Mirrors notifications-drawer:
  // ignore clicks on the drawer itself, on either edge tab, and on any
  // detached portal content the drawer owns. The `SetupInterceptionModal`
  // is a separate Radix-portaled dialog — clicks on it land outside the
  // drawer node, so we explicitly skip the dismiss while it's mounted to
  // avoid the modal's first interaction collapsing the drawer behind it.
  useEffect(() => {
    if (!open) return;
    if (showInterception) return;
    function handleOutsideMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      const path = e.composedPath();

      if (drawerRef.current && drawerRef.current.contains(target)) return;
      if (drawerRef.current && path.includes(drawerRef.current)) return;

      for (const node of path) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.dataset?.edgeTab) return;
        if (node.dataset?.edgeTabDetached === "true") return;
        // Radix portals — used by the SetupInterceptionModal — sit at
        // document.body. Skip them so the modal can interact freely.
        if (node.getAttribute?.("role") === "dialog") return;
      }

      close(EDGE_TAB_ID);
    }
    document.addEventListener("mousedown", handleOutsideMouseDown, true);
    return () =>
      document.removeEventListener("mousedown", handleOutsideMouseDown, true);
  }, [open, close, showInterception]);

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

  const handleAction = (action: FABAction) => {
    gatedAction(() => {
      if (isWindowAction(action)) {
        if (action.target === "project-workspace") {
          // Project workspace uses its own opener so two clicks for the
          // same project hit a single window. Mode comes from action.meta
          // (defaulting to "creating" — that's how the FAB lands here).
          openProjectWindow({
            projectId: null,
            mode: action.meta?.initialMode ?? "creating",
          });
        } else {
          openWindow({
            id: action.target,
            title: resolveActionLabel(action, t),
            type: action.target,
          });
        }
      } else {
        router.push(action.target as string);
      }
      close(EDGE_TAB_ID);
    }, action.triggerAction);
  };

  const handleCustomize = () => {
    router.push("/settings?tab=quick-actions");
    close(EDGE_TAB_ID);
  };

  const variants = reducedMotion
    ? quickActionsDrawerVariantsReduced
    : quickActionsDrawerVariants;
  const rowVariants = reducedMotion
    ? quickActionsRowVariantsReduced
    : quickActionsRowVariants;

  // Anchor the panel vertically: rail center is at (railTop + (vh - railTop - railBottom)/2);
  // tab center sits at rail-center + STACK_OFFSET_QA; panel centers on tab center.
  // Use absolute positioning with `top: calc(50% + offset)` inside a rail-anchored wrapper.
  if (!visible) return null;

  // Width clamp — keep the panel ≤ (viewport - 36px) on narrow screens so
  // the drawer never extends past the viewport edge (bug edfdd057). Mirrors
  // the notifications drawer pattern. The 36px reserve covers the tab's
  // rounded outer edge (28px) + an 8px breathing margin.
  const panelWidth = `min(${PANEL_W}px, calc(100vw - 36px))`;

  return (
    <>
      <AnimatePresence mode="wait">
        {open && (
          <div
            aria-hidden={false}
            style={{
              position: "fixed",
              top: RAIL_TOP,
              right: 0,
              bottom: RAIL_BOTTOM,
              width: panelWidth,
              maxWidth: "calc(100vw - 36px)",
              pointerEvents: "none",
              zIndex: 1500,
            }}
          >
            <motion.aside
              ref={drawerRef}
              key="quick-actions-drawer"
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="complementary"
              aria-label={t("drawer.ariaLabel")}
              style={{
                position: "absolute",
                top: `calc(50% + ${STACK_OFFSET_QA - PANEL_H / 2}px)`,
                right: 0,
                width: panelWidth,
                maxWidth: "calc(100vw - 36px)",
                height: PANEL_H,
                display: "flex",
                flexDirection: "column",
                background: "rgba(32, 34, 38, 0.92)",
                backdropFilter: "blur(28px) saturate(1.3)",
                WebkitBackdropFilter: "blur(28px) saturate(1.3)",
                border: "1px solid rgba(255, 255, 255, 0.18)",
                borderRight: "none",
                pointerEvents: "auto",
                overflow: "hidden",
                boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04)",
              }}
            >
              {/* Top-edge highlight gradient */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)",
                }}
              />

              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "14px 16px 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-mute)",
                    letterSpacing: "0.16em",
                  }}
                >
                  {"//"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-cakemono)",
                    fontWeight: 300,
                    fontSize: 13,
                    color: "var(--text)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginLeft: 6,
                  }}
                >
                  {t("drawer.title")}
                </span>
                <div style={{ flex: 1 }} />
                <span
                  aria-hidden
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: "var(--text-2)",
                    letterSpacing: 0,
                    padding: "2px 6px",
                    minWidth: 16,
                    textAlign: "center",
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  {t("drawer.shortcutHint")}
                </span>
              </div>

              {/* Action list */}
              <div
                role="list"
                className="hide-scrollbar"
                style={{
                  flex: 1,
                  overflowY: "auto",
                  overflowX: "hidden",
                  padding: "8px 8px",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {actions.length === 0 && (
                  <div style={{ padding: 24, textAlign: "center" }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--text-mute)",
                        letterSpacing: "0.16em",
                      }}
                    >
                      {t("empty.noActions")}
                    </span>
                  </div>
                )}
                {actions.map((action, i) => {
                  const Icon = action.icon;
                  return (
                    <motion.button
                      key={action.id}
                      type="button"
                      role="listitem"
                      custom={i}
                      variants={rowVariants}
                      initial="hidden"
                      animate="visible"
                      onClick={() => handleAction(action)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 4,
                        border: "none",
                        background: "transparent",
                        color: "var(--text-2)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: reducedMotion
                          ? "none"
                          : "background 150ms var(--ease-smooth), color 150ms var(--ease-smooth)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "rgba(255,255,255,0.05)";
                        e.currentTarget.style.color = "var(--text)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text-2)";
                      }}
                    >
                      <Icon className="h-[14px] w-[14px] shrink-0 text-[var(--text-3)]" />
                      <span
                        style={{
                          fontFamily: "var(--font-mohave)",
                          fontSize: 13,
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {resolveActionLabel(action, t)}
                      </span>
                      <span
                        aria-hidden
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 9,
                          color: "var(--text-mute)",
                          letterSpacing: "0.12em",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {action.hintCode}
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              {/* Footer — CUSTOMIZE → */}
              <button
                type="button"
                onClick={handleCustomize}
                aria-label={t("footer.customizeAriaLabel")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 16px",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  borderLeft: "none",
                  borderRight: "none",
                  borderBottom: "none",
                  background: "transparent",
                  color: "var(--text-3)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  transition: reducedMotion
                    ? "none"
                    : "color 150ms var(--ease-smooth)",
                  position: "relative",
                  zIndex: 1,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-3)";
                }}
              >
                <span>{t("footer.customize")}</span>
                <span aria-hidden>→</span>
              </button>
            </motion.aside>
          </div>
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
