"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ComponentType } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActionPromptConfig {
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  ctaLabel: string;
  ctaAction: () => void;
  persistent?: boolean; // default true — stays until dismissed
  dismissable?: boolean; // default true — shows X button
  permanentDismiss?: boolean; // default true — X button adds to dismissedIds; false = temporary remove only
  autoDismissMs?: number; // auto-remove delay (only when persistent=false)
  variant?: "default" | "accent"; // accent = steel-blue left border
}

interface ActionPromptState {
  activePrompts: ActionPromptConfig[];
  dismissedIds: string[];
  showPrompt: (config: ActionPromptConfig) => void;
  dismissPrompt: (id: string, permanent?: boolean) => void;
  removePrompt: (id: string) => void;
  isDismissed: (id: string) => boolean;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useActionPromptStore = create<ActionPromptState>()(
  persist(
    (set, get) => ({
      activePrompts: [],
      dismissedIds: [],

      showPrompt: (config) => {
        const { activePrompts, dismissedIds } = get();
        if (dismissedIds.includes(config.id)) return;
        if (activePrompts.some((p) => p.id === config.id)) return;
        set({ activePrompts: [...activePrompts, config] });
      },

      dismissPrompt: (id, permanent = false) => {
        const { activePrompts, dismissedIds } = get();
        set({
          activePrompts: activePrompts.filter((p) => p.id !== id),
          ...(permanent && !dismissedIds.includes(id)
            ? { dismissedIds: [...dismissedIds, id] }
            : {}),
        });
      },

      removePrompt: (id) => {
        set({
          activePrompts: get().activePrompts.filter((p) => p.id !== id),
        });
      },

      isDismissed: (id) => get().dismissedIds.includes(id),
    }),
    {
      name: "ops-action-prompts",
      partialize: (state) => ({
        dismissedIds: state.dismissedIds,
      }),
    }
  )
);
