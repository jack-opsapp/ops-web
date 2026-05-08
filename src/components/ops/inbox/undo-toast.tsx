"use client";

/**
 * UndoToast — portaled toast with a 5-second countdown and an Undo button.
 *
 * Consumers queue a toast via `enqueueUndoToast({ message, onUndo })`. The
 * provider (`<UndoToastHost />`) renders a stack of active toasts top-right
 * (below the top bar), animates each in/out with EASE_SMOOTH, and fires the
 * onUndo callback if the user clicks "Undo" before the countdown ends.
 *
 * The toast host is a singleton mounted once at the inbox page level — other
 * pages can also mount it if they need undo semantics.
 *
 * Design: frosted glass-dense surface, 12px radius, left-aligned text,
 * ops-amber countdown bar, no shadows. Reduced-motion fallback: opacity only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Undo2 } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { KeyHint } from "@/components/ui/key-hint";
import { useDictionary } from "@/i18n/client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UndoToastInput {
  message: string;
  /** Optional short subline rendered under the message. */
  detail?: string;
  /** Invoked if the user clicks "Undo" before the countdown ends. */
  onUndo: () => void | Promise<void>;
  /** Invoked when the toast self-resolves (timeout). */
  onExpire?: () => void;
  /** Custom duration, in ms. Default 5000. */
  durationMs?: number;
}

interface ActiveToast extends Required<Omit<UndoToastInput, "detail">> {
  id: string;
  detail: string | null;
  createdAt: number;
}

// ─── Event bus ───────────────────────────────────────────────────────────────

type ToastEvent =
  | { type: "enqueue"; toast: ActiveToast }
  | { type: "dismiss"; id: string };

const listeners = new Set<(e: ToastEvent) => void>();

function emit(event: ToastEvent) {
  for (const listener of listeners) listener(event);
}

function toastId() {
  return `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Enqueue an undo toast from anywhere in the app. Safe to call outside React. */
export function enqueueUndoToast(input: UndoToastInput): string {
  const id = toastId();
  const toast: ActiveToast = {
    id,
    message: input.message,
    detail: input.detail ?? null,
    onUndo: input.onUndo,
    onExpire: input.onExpire ?? (() => {}),
    durationMs: input.durationMs ?? 5000,
    createdAt: Date.now(),
  };
  emit({ type: "enqueue", toast });
  return id;
}

/** Dismiss a toast by id (without firing onUndo or onExpire). */
export function dismissUndoToast(id: string) {
  emit({ type: "dismiss", id });
}

// ─── Last-action context (for `z` keyboard shortcut) ─────────────────────────

interface UndoContextValue {
  /** Invoke the most recent undo toast's onUndo callback, if any is active. */
  triggerLatest: () => void;
}

const UndoContext = createContext<UndoContextValue>({ triggerLatest: () => {} });

export function useUndoShortcut() {
  return useContext(UndoContext);
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

type State = ActiveToast[];

type Action =
  | { type: "push"; toast: ActiveToast }
  | { type: "remove"; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "push":
      // Cap at 3 visible toasts; drop the oldest silently.
      return [...state.slice(Math.max(0, state.length - 2)), action.toast];
    case "remove":
      return state.filter((t) => t.id !== action.id);
  }
}

// ─── Single toast row ────────────────────────────────────────────────────────

interface ToastRowProps {
  toast: ActiveToast;
  onResolve: (id: string, mode: "undo" | "expire" | "dismiss") => void;
}

function ToastRow({ toast, onResolve }: ToastRowProps) {
  const { t } = useDictionary("inbox");
  const reduceMotion = useReducedMotion();
  const id = useId();
  const timerRef = useRef<number | null>(null);
  const [, force] = useReducer((n: number) => n + 1, 0);

  // Timer tick for progress bar (updates 60fps-ish via rAF loop).
  useEffect(() => {
    let raf = 0;
    let active = true;
    const tick = () => {
      if (!active) return;
      force();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // Auto-expire.
  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      onResolve(toast.id, "expire");
    }, toast.durationMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.durationMs, onResolve]);

  const elapsed = Date.now() - toast.createdAt;
  const remaining = Math.max(0, toast.durationMs - elapsed);
  const pct = Math.max(0, Math.min(100, (remaining / toast.durationMs) * 100));

  const handleUndo = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    onResolve(toast.id, "undo");
  }, [toast.id, onResolve]);

  const variants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.15 } },
        exit: { opacity: 0, transition: { duration: 0.12 } },
      }
    : {
        hidden: { opacity: 0, y: -8, scale: 0.98 },
        visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: EASE_SMOOTH } },
        exit: { opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.16, ease: EASE_SMOOTH } },
      };

  return (
    <motion.div
      layout="position"
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={variants}
      role="status"
      aria-live="polite"
      aria-labelledby={`${id}-msg`}
      className="pointer-events-auto glass-dense relative w-[340px] overflow-hidden"
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p
            id={`${id}-msg`}
            className="font-cakemono font-light uppercase text-[12px] tracking-[0.12em] text-text leading-tight"
          >
            {toast.message}
          </p>
          {toast.detail && (
            <p className="font-mono text-[11px] text-text-3 mt-0.5 truncate">
              {toast.detail}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleUndo}
          className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-md border border-line bg-inbox-elev/60 hover:bg-inbox-elev transition-colors"
        >
          <Undo2 className="w-[12px] h-[12px] text-text-2" strokeWidth={1.5} />
          <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text-2">
            {t("toast.undo", "Undo")}
          </span>
          <KeyHint keys="Z" variant="inline" className="text-text-mute" />
        </button>
      </div>

      {/* Countdown bar */}
      <div
        aria-hidden
        className="absolute bottom-0 left-0 h-[2px] bg-ops-amber/80"
        style={{
          width: `${pct}%`,
          transition: reduceMotion ? "none" : "width 80ms linear",
        }}
      />
    </motion.div>
  );
}

// ─── Host (mount once per page) ──────────────────────────────────────────────

export function UndoToastHost() {
  const [toasts, dispatch] = useReducer(reducer, [] as State);
  const latestRef = useRef<ActiveToast | null>(null);
  latestRef.current = toasts[toasts.length - 1] ?? null;

  useEffect(() => {
    const handler = (e: ToastEvent) => {
      if (e.type === "enqueue") dispatch({ type: "push", toast: e.toast });
      else if (e.type === "dismiss") dispatch({ type: "remove", id: e.id });
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const resolve = useCallback(
    (id: string, mode: "undo" | "expire" | "dismiss") => {
      const toast = toasts.find((t) => t.id === id);
      dispatch({ type: "remove", id });
      if (!toast) return;
      if (mode === "undo") {
        try {
          const ret = toast.onUndo();
          if (ret && typeof (ret as Promise<void>).catch === "function") {
            (ret as Promise<void>).catch((err) => console.error("[undo-toast]", err));
          }
        } catch (err) {
          console.error("[undo-toast]", err);
        }
      } else if (mode === "expire") {
        try {
          toast.onExpire();
        } catch (err) {
          console.error("[undo-toast]", err);
        }
      }
    },
    [toasts]
  );

  // `z` triggers the most recent toast's undo when focus isn't in an input.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "z" && e.key !== "Z") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!latestRef.current) return;
      e.preventDefault();
      resolve(latestRef.current.id, "undo");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [resolve]);

  const value = useMemo<UndoContextValue>(
    () => ({
      triggerLatest: () => {
        if (latestRef.current) resolve(latestRef.current.id, "undo");
      },
    }),
    [resolve]
  );

  // Render inside a portal so toasts escape any overflow-hidden containers.
  if (typeof window === "undefined") return null;

  return (
    <UndoContext.Provider value={value}>
      {createPortal(
        <div
          className="pointer-events-none fixed top-[72px] right-6 z-[3000] flex flex-col items-end gap-2"
          aria-label="Undo notifications"
          data-testid="undo-toast-host"
        >
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <ToastRow key={toast.id} toast={toast} onResolve={resolve} />
            ))}
          </AnimatePresence>
        </div>,
        document.body
      )}
    </UndoContext.Provider>
  );
}
