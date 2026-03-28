"use client";

import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import { ALL_ACTIONS, DEFAULT_ACTION_IDS } from "@/lib/constants/fab-actions";

// ─── Component ────────────────────────────────────────────────────────────────

export function QuickActionsTab() {
  const { currentUser, updateFabActions } = useAuthStore();
  const activeIds: string[] = currentUser?.fabActions ?? DEFAULT_ACTION_IDS;

  function toggle(id: string) {
    const isActive = activeIds.includes(id);
    if (isActive) {
      // Prevent removing the last action
      if (activeIds.length <= 1) return;
      updateFabActions(activeIds.filter((a) => a !== id));
    } else {
      updateFabActions([...activeIds, id]);
    }
  }

  function resetToDefaults() {
    updateFabActions(DEFAULT_ACTION_IDS);
  }

  return (
    <div className="space-y-3 max-w-3xl">
      <p className="font-kosugi text-[11px] text-text-tertiary">
        Choose which actions appear in the quick-add menu. Long-press the FAB on desktop to reorder.
      </p>

      <Card>
        <CardContent className="p-0">
          {ALL_ACTIONS.map((action, index) => {
            const Icon = action.icon;
            const isActive = activeIds.includes(action.id);
            const isLast = index === ALL_ACTIONS.length - 1;

            return (
              <div
                key={action.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-[10px]",
                  !isLast && "border-b border-[rgba(255,255,255,0.04)]"
                )}
              >
                <Icon className="w-[16px] h-[16px] text-text-secondary shrink-0" />
                <span className="font-mohave text-[14px] text-text-primary flex-1">
                  {action.label}
                </span>
                <button
                  onClick={() => toggle(action.id)}
                  disabled={isActive && activeIds.length <= 1}
                  className={cn(
                    "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    isActive ? "bg-ops-accent" : "bg-background-elevated"
                  )}
                  aria-label={isActive ? `Remove ${action.label}` : `Add ${action.label}`}
                >
                  <span
                    className={cn(
                      "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                      isActive ? "right-[2px]" : "left-[2px]"
                    )}
                  />
                </button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <button
        onClick={resetToDefaults}
        className="font-kosugi text-[11px] text-text-disabled hover:text-text-tertiary transition-colors"
      >
        Reset to defaults
      </button>
    </div>
  );
}
