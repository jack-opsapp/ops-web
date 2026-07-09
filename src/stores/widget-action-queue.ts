import { create } from "zustand";
import { toast } from "@/components/ui/toast";

// ── Types ────────────────────────────────────────────────────────────

interface QueuedAction {
  id: string;
  type: string;
  label: string;
  entityId: string;
  executeAt: number;
  executeFn: () => Promise<void>;
  undoFn?: () => void;
  timerId: ReturnType<typeof setTimeout>;
  toastId: string | number;
}

interface WidgetActionQueueState {
  actions: QueuedAction[];
  /** Queue a deferred action with undo window (default 5 min) */
  queueAction: (
    action: Pick<QueuedAction, "type" | "label" | "entityId" | "executeFn" | "undoFn">,
    delayMs?: number
  ) => string;
  /** Cancel a queued action and call its undoFn if provided */
  undoAction: (id: string) => void;
  /** Cancel all queued actions */
  clearAll: () => void;
}

// ── Store ────────────────────────────────────────────────────────────

export const useWidgetActionQueue = create<WidgetActionQueueState>(
  (set, get) => ({
    actions: [],

    queueAction: (action, delayMs = 300_000) => {
      const id = crypto.randomUUID();
      const executeAt = Date.now() + delayMs;

      // Schedule execution after delay
      const timerId = setTimeout(async () => {
        const current = get().actions.find((a) => a.id === id);
        if (!current) return;
        try {
          await current.executeFn();
        } finally {
          set((s) => ({ actions: s.actions.filter((a) => a.id !== id) }));
        }
      }, delayMs);

      // Show Sonner toast with undo button
      const toastId = toast(action.label, {
        duration: Math.min(delayMs, 30_000), // Toast visible for up to 30s
        action: {
          label: "Undo",
          onClick: () => get().undoAction(id),
        },
      });

      const queued: QueuedAction = {
        ...action,
        id,
        executeAt,
        timerId,
        toastId,
      };

      set((s) => ({ actions: [...s.actions, queued] }));
      return id;
    },

    undoAction: (id) => {
      const action = get().actions.find((a) => a.id === id);
      if (!action) return;
      clearTimeout(action.timerId);
      toast.dismiss(action.toastId);
      action.undoFn?.();
      set((s) => ({ actions: s.actions.filter((a) => a.id !== id) }));
    },

    clearAll: () => {
      for (const action of get().actions) {
        clearTimeout(action.timerId);
        toast.dismiss(action.toastId);
      }
      set({ actions: [] });
    },
  })
);
