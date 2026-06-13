"use client";

/**
 * Quick Actions drawer (WEB OVERHAUL P2 restyle).
 *
 * Unified rail anatomy: 360px glass-dense panel, left corners radius 10,
 * `// TITLE` header with the Q shortcut chip, content-driven height
 * (computeQuickActionsPanelHeight, capped 452), CUSTOMIZE → footer.
 * Outside-click dismiss is owned by the global EdgeTabOutsideDismiss
 * (data-edge-tab-drawer + role=dialog checks cover the setup-interception
 * modal) — the drawer-local duplicate handler is gone.
 */

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
import { isWindowAction, type FABAction } from "@/lib/constants/fab-actions";
import {
  quickActionsDrawerVariants,
  quickActionsDrawerVariantsReduced,
  quickActionsRowVariants,
  quickActionsRowVariantsReduced,
} from "@/lib/utils/motion";
import { computeQuickActionsPanelHeight } from "./quick-actions-tab";
import {
  EDGE_DRAWER_PADDING,
  EDGE_RAIL_BOTTOM,
  EDGE_RAIL_STACK,
  EDGE_RAIL_TOP,
  EDGE_Z_DRAWER,
  getEdgeRailDrawerWidthStyle,
  getEdgeRailHeightStyle,
  getEdgeRailTopStyle,
} from "@/components/ui/edge-rail-layout";

const EDGE_TAB_ID = "quick-actions";
const RAIL = EDGE_RAIL_STACK.quickActions;

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
  // Phase P3.3 — client-workspace dispatch mirrors the project opener.
  const openClientWindow = useWindowStore((s) => s.openClientWindow);
  const reducedMotion = useReducedMotion();
  const actions = useQuickActions();
  const PANEL_H = computeQuickActionsPanelHeight(actions.length);

  // Setup gate — reused from the deleted FAB component
  const { isComplete, missingSteps } = useSetupGate();
  const [showInterception, setShowInterception] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(
    null,
  );
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
        if (action.target === "project-workspace") {
          // Project workspace uses its own opener so two clicks for the
          // same project hit a single window. Mode comes from action.meta
          // (defaulting to "creating" — that's how the FAB lands here).
          openProjectWindow({
            projectId: null,
            mode: action.meta?.initialMode ?? "creating",
          });
        } else if (action.target === "client-workspace") {
          openClientWindow({
            clientId: null,
            mode: action.meta?.initialMode ?? "creating",
          });
        } else {
          openWindow({
            id: action.target,
            title: t(action.labelKey),
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

  if (!visible) return null;

  // Width clamp — keep the panel ≤ (viewport - 36px) on narrow screens so
  // the drawer never extends past the viewport edge (bug edfdd057).
  const panelWidth = getEdgeRailDrawerWidthStyle(RAIL.drawerWidth);

  return (
    <>
      <AnimatePresence mode="wait">
        {open && (
          <div
            aria-hidden={false}
            style={{
              position: "fixed",
              top: EDGE_RAIL_TOP,
              right: 0,
              bottom: EDGE_RAIL_BOTTOM,
              width: panelWidth,
              maxWidth: "calc(100vw - 36px)",
              pointerEvents: "none",
              zIndex: EDGE_Z_DRAWER,
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
                top: getEdgeRailTopStyle(PANEL_H, RAIL.stackOffset),
                right: 0,
                width: panelWidth,
                maxWidth: "calc(100vw - 36px)",
                height: getEdgeRailHeightStyle(PANEL_H),
                display: "flex",
                flexDirection: "column",
                background: "var(--glass-dense)",
                backdropFilter: "blur(28px) saturate(1.3)",
                WebkitBackdropFilter: "blur(28px) saturate(1.3)",
                border: "1px solid var(--glass-border)",
                borderRight: "none",
                borderTopLeftRadius: 12,
                borderBottomLeftRadius: 12,
                pointerEvents: "auto",
                overflow: "hidden",
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
                  padding: EDGE_DRAWER_PADDING.header,
                  borderBottom: "1px solid var(--line)",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {/* Kit widget header: `// TITLE` — one JetBrains Mono 11px
                    uppercase run, slash in --text-mute (Widget.jsx anatomy). */}
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                  }}
                >
                  <span aria-hidden style={{ color: "var(--text-mute)" }}>
                    {"// "}
                  </span>
                  {t("drawer.title")}
                </span>
                <div style={{ flex: 1 }} />
                <span
                  aria-hidden
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-2)",
                    letterSpacing: 0,
                    padding: "2px 6px",
                    minWidth: 16,
                    textAlign: "center",
                    border: "1px solid var(--line)",
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.06)",
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
                  <div style={{ padding: 24 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--text-3)",
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
                          fontSize: 14,
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t(action.labelKey)}
                      </span>
                      <span
                        aria-hidden
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          color: "var(--text-3)",
                          letterSpacing: "0.12em",
                          fontFeatureSettings: '"tnum" 1, "zero" 1',
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
                  padding: EDGE_DRAWER_PADDING.footer,
                  borderTop: "1px solid var(--line)",
                  borderLeft: "none",
                  borderRight: "none",
                  borderBottom: "none",
                  background: "transparent",
                  color: "var(--text-3)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
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
