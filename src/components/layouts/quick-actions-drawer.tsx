"use client";

import { useState, useEffect, useCallback } from "react";
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
  type FABAction,
} from "@/lib/constants/fab-actions";
import {
  quickActionsDrawerVariants,
  quickActionsDrawerVariantsReduced,
  quickActionsRowVariants,
  quickActionsRowVariantsReduced,
} from "@/lib/utils/motion";

const EDGE_TAB_ID = "quick-actions";

// Spec V1 (ops-design-system-v2/project/fab/variants.jsx):
// 308×452 panel anchored to the tab's vertical center via stackOffset.
const PANEL_W = 308;
const PANEL_H = 452;
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
  const reducedMotion = useReducedMotion();
  const actions = useQuickActions();

  // Setup gate — reused from the deleted FAB component
  const { isComplete, missingSteps } = useSetupGate();
  const [showInterception, setShowInterception] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [triggerAction, setTriggerActionState] = useState("projects");

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
        openWindow({
          id: action.target,
          title: action.label,
          type: action.target,
        });
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
              width: PANEL_W,
              pointerEvents: "none",
              zIndex: 1500,
            }}
          >
            <motion.aside
              key="quick-actions-drawer"
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="complementary"
              aria-label={t("drawer.ariaLabel")}
              data-edge-tab-drawer="quick-actions"
              style={{
                position: "absolute",
                top: `calc(50% + ${STACK_OFFSET_QA - PANEL_H / 2}px)`,
                right: 0,
                width: PANEL_W,
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
                        {action.label}
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
