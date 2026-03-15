"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Plus, Minus } from "lucide-react";
import { type FABAction, ALL_ACTIONS, DEFAULT_ACTION_IDS, isWindowAction } from "@/lib/constants/fab-actions";
import { cn } from "@/lib/utils/cn";
import { useWindowStore } from "@/stores/window-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import { getSlugForRoute } from "@/lib/feature-flags/feature-flag-definitions";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import {
  SPRING_FAB,
  fabOverlayVariants,
  fabItemVariants,
  fabItemVariantsReduced,
  fabBadgeVariants,
  fabBadgeVariantsReduced,
} from "@/lib/utils/motion";

// ─── Component ───────────────────────────────────────────────────────────────

export function FloatingActionButton() {
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();
  const openWindow = useWindowStore((s) => s.openWindow);
  const { currentUser, updateFabActions } = useAuthStore();
  const can = usePermissionStore((s) => s.can);
  const canAccessFeature = useFeatureFlagsStore((s) => s.canAccessFeature);

  // ── Setup gate ──────────────────────────────────────────────────────────
  const { isComplete, missingSteps } = useSetupGate();
  const [showInterception, setShowInterception] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [triggerAction, setTriggerActionState] = useState("projects");

  // ── Reduced motion ──────────────────────────────────────────────────────
  const prefersReducedMotion = useReducedMotion();

  // ── Active actions from user prefs ──────────────────────────────────────
  const userActionIds = currentUser?.fabActions ?? DEFAULT_ACTION_IDS;
  const activeActions = userActionIds
    .map((id) => ALL_ACTIONS.find((a) => a.id === id))
    .filter((action): action is FABAction => !!action)
    .filter((action) => !action.requiredPermission || can(action.requiredPermission))
    .filter((action) => {
      const route =
        typeof action.target === "string" && action.target.startsWith("/")
          ? action.target.split("?")[0]
          : null;
      if (!route) return true;
      const slug = getSlugForRoute(route);
      if (!slug) return true;
      return canAccessFeature(slug);
    });

  // ── Close on outside click ──────────────────────────────────────────────
  useEffect(() => {
    if (!open && !editMode) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setEditMode(false);
        setShowAddDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, editMode]);

  // ── Close on Escape ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open && !editMode) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setEditMode(false);
        setShowAddDropdown(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, editMode]);

  // ── Gated action (setup check) ─────────────────────────────────────────
  const gatedAction = useCallback(
    (action: () => void, triggerName: string) => {
      if (!isComplete) {
        setPendingAction(() => action);
        setTriggerActionState(triggerName);
        setShowInterception(true);
        return;
      }
      action();
    },
    [isComplete]
  );

  // ── Handle action click ─────────────────────────────────────────────────
  const handleAction = (action: FABAction) => {
    if (editMode) return;
    if (action.requiredPermission && !can(action.requiredPermission)) return;
    gatedAction(() => {
      if (isWindowAction(action)) {
        openWindow({
          id: action.target,
          title: action.label,
          type: action.target,
        });
      } else {
        router.push(action.target);
      }
      setOpen(false);
    }, action.triggerAction);
  };

  // ── Edit mode: remove / add actions ─────────────────────────────────────
  const removeAction = (id: string) => {
    // Read fresh state to avoid stale closure on rapid clicks
    const fresh = useAuthStore.getState().currentUser?.fabActions ?? DEFAULT_ACTION_IDS;
    updateFabActions(fresh.filter((a) => a !== id));
  };

  const addAction = (id: string) => {
    const fresh = useAuthStore.getState().currentUser?.fabActions ?? DEFAULT_ACTION_IDS;
    updateFabActions([...fresh, id]);
    setShowAddDropdown(false);
  };

  // ── Long-press to enter edit mode ───────────────────────────────────────
  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => {
      setEditMode(true);
      setOpen(true);
    }, 1000);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Cancel long-press timer on unmount
  useEffect(() => {
    return () => cancelLongPress();
  }, []);

  return (
    <>
      {/* ── Overlay — right-edge gradient ── */}
      <AnimatePresence>
        {(open || editMode) && (
          <motion.div
            className="fixed inset-0 z-[94]"
            style={{
              background:
                "linear-gradient(to left, rgba(10,10,10,0.85), transparent)",
            }}
            variants={fabOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={() => {
              setOpen(false);
              setEditMode(false);
              setShowAddDropdown(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── FAB container ── */}
      <div ref={containerRef} className="fixed bottom-4 right-6 z-[95]">
        {/* ── Menu items — frosted glass pills, staggered from right ── */}
        <AnimatePresence>
          {(open || editMode) && (
            <div className="absolute bottom-[60px] right-0 flex flex-col-reverse gap-2">
              {activeActions.map((action, i) => (
                <motion.button
                  key={action.id}
                  custom={i}
                  variants={prefersReducedMotion ? fabItemVariantsReduced : fabItemVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  onClick={() => handleAction(action)}
                  className={cn(
                    "relative flex items-center gap-2 pl-2 pr-3 py-2 rounded-[4px]",
                    "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]",
                    "border border-[rgba(255,255,255,0.08)]",
                    "hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.05)]",
                    "transition-colors duration-150 whitespace-nowrap"
                  )}
                  whileHover={prefersReducedMotion ? undefined : { scale: 1.02 }}
                >
                  {/* Edit mode: minus badge */}
                  {editMode && activeActions.length > 1 && (
                    <motion.div
                      variants={
                        prefersReducedMotion ? fabBadgeVariantsReduced : fabBadgeVariants
                      }
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAction(action.id);
                      }}
                      className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-full bg-[#93321A] flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-2 h-2 text-white" />
                    </motion.div>
                  )}
                  <action.icon className="w-4 h-4 text-[#E5E5E5] shrink-0" />
                  <span className="font-mohave text-[14px] font-light text-[#E5E5E5]">
                    {action.label}
                  </span>
                </motion.button>
              ))}

              {/* Edit mode: Add Action ghost pill */}
              {editMode && activeActions.length < ALL_ACTIONS.length && (
                <motion.button
                  variants={prefersReducedMotion ? fabItemVariantsReduced : fabItemVariants}
                  custom={activeActions.length}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  onClick={() => setShowAddDropdown((prev) => !prev)}
                  className={cn(
                    "flex items-center gap-2 pl-2 pr-3 py-2 rounded-[4px]",
                    "border border-dashed border-[rgba(255,255,255,0.08)]",
                    "hover:border-[rgba(255,255,255,0.15)]",
                    "transition-colors duration-150 whitespace-nowrap"
                  )}
                >
                  <Plus className="w-4 h-4 text-[#999999] shrink-0" />
                  <span className="font-mohave text-[14px] font-light text-[#999999]">
                    Add Action
                  </span>
                </motion.button>
              )}

              {/* Add action dropdown */}
              <AnimatePresence>
                {showAddDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      "absolute top-0 right-full mr-2 flex flex-col gap-1 p-1 rounded-[4px]",
                      "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]",
                      "border border-[rgba(255,255,255,0.08)]"
                    )}
                  >
                    {ALL_ACTIONS.filter(
                      (a) => !userActionIds.includes(a.id)
                    ).map((action) => (
                      <button
                        key={action.id}
                        onClick={() => addAction(action.id)}
                        className={cn(
                          "flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-[4px]",
                          "hover:bg-[rgba(255,255,255,0.05)]",
                          "transition-colors duration-150 whitespace-nowrap"
                        )}
                      >
                        <action.icon className="w-4 h-4 text-[#999999] shrink-0" />
                        <span className="font-mohave text-[14px] font-light text-[#999999]">
                          {action.label}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </AnimatePresence>

        {/* ── FAB button — 52px frosted glass ── */}
        <motion.button
          onClick={() => !editMode && setOpen((prev) => !prev)}
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          className={cn(
            "w-[52px] h-[52px] rounded-full flex items-center justify-center",
            "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]",
            "border-2 border-[rgba(255,255,255,0.20)]",
            "hover:border-[rgba(255,255,255,0.30)]",
            "transition-colors duration-150"
          )}
          animate={{ rotate: open || editMode ? 225 : 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : SPRING_FAB}
          title="Quick actions"
        >
          <Plus className="w-5 h-5 text-[#E5E5E5]" />
        </motion.button>
      </div>

      {/* ── Setup interception modal ── */}
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
