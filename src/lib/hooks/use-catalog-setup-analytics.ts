"use client";

/**
 * Thin glue hook over the pure wizard_analytics dispatcher (plan Task 6.8). It
 * closes over the live company/user/session/totalSteps and exposes the six
 * lifecycle trackers (shown / started / step_completed / skipped / abandoned /
 * completed, spec §16) the catalog-setup route fires. Every call is
 * fire-and-forget; missing company/user context simply no-ops (analytics never
 * blocks the wizard). De-dupes one-shot events (shown/started/per-module
 * step_completed) and the terminal event (only one of completed/skipped/
 * abandoned ever fires) internally, and best-effort fires `abandoned` on
 * unmount + beforeunload when the session ended without a terminal action.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  dispatchWizardEvent,
  type AnalyticsInput,
  type WizardAnalyticsEvent,
} from "@/lib/catalog-setup/analytics";

/** Canvas module → analytics step index (stable order for the funnel). */
const STEP_INDEX: Record<string, number> = { sell: 0, stock: 1, types: 2, review: 3 };

export interface CatalogSetupAnalyticsParams {
  sessionId: string;
  /** Number of visible modules the operator could complete (gates-aware). */
  totalSteps: number;
  /** "first_run_takeover" | "kebab_reentry" — context for the `shown` event. */
  triggerType?: string;
  triggerContext?: string;
  /** True when re-entering a populated catalog (spec §16 "Re-run"). */
  isRestart?: boolean;
}

export interface CatalogSetupAnalytics {
  trackShown: () => void;
  trackStarted: () => void;
  trackStepCompleted: (moduleKey: string) => void;
  trackSkipped: () => void;
  trackCompleted: () => void;
}

export function useCatalogSetupAnalytics(
  params: CatalogSetupAnalyticsParams,
): CatalogSetupAnalytics {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? "";
  const userRole = currentUser?.role ?? undefined;

  // One-shot + terminal bookkeeping survives re-renders without re-firing.
  const startedAtRef = useRef<number>(Date.now());
  const shownRef = useRef(false);
  const startedRef = useRef(false);
  const terminalRef = useRef(false);
  const stepsFired = useRef<Set<string>>(new Set());

  // Latest params/context for the unmount/beforeunload abandon path.
  const ctxRef = useRef({ companyId, userId, userRole, params });
  ctxRef.current = { companyId, userId, userRole, params };

  const fire = useCallback(
    (event: WizardAnalyticsEvent, extra: Partial<AnalyticsInput> = {}) => {
      const { companyId: cid, userId: uid, userRole: role, params: p } = ctxRef.current;
      if (!cid || !uid) return; // no tenant/user context → skip (best-effort)
      void dispatchWizardEvent({
        companyId: cid,
        userId: uid,
        userRole: role ? String(role) : undefined,
        sessionId: p.sessionId,
        totalSteps: p.totalSteps,
        event,
        ...extra,
      });
    },
    [],
  );

  const trackShown = useCallback(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    const p = ctxRef.current.params;
    fire("shown", {
      triggerType: p.triggerType,
      triggerContext: p.triggerContext,
      isRestart: p.isRestart,
    });
  }, [fire]);

  const trackStarted = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startedAtRef.current = Date.now();
    fire("started", { isRestart: ctxRef.current.params.isRestart });
  }, [fire]);

  const trackStepCompleted = useCallback(
    (moduleKey: string) => {
      if (stepsFired.current.has(moduleKey)) return;
      stepsFired.current.add(moduleKey);
      fire("step_completed", {
        stepId: moduleKey.toUpperCase(),
        stepIndex: STEP_INDEX[moduleKey] ?? stepsFired.current.size - 1,
      });
    },
    [fire],
  );

  const trackSkipped = useCallback(() => {
    if (terminalRef.current) return;
    terminalRef.current = true;
    fire("skipped");
  }, [fire]);

  const trackCompleted = useCallback(() => {
    if (terminalRef.current) return;
    terminalRef.current = true;
    const p = ctxRef.current.params;
    fire("completed", {
      durationMs: Date.now() - startedAtRef.current,
      stepsSkipped: Math.max(0, p.totalSteps - stepsFired.current.size),
      isRestart: p.isRestart,
    });
  }, [fire]);

  // Abandon: leaving without a terminal action (and after starting) is an
  // abandon. Covers tab close (beforeunload) + route unmount.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (startedRef.current && !terminalRef.current) {
        terminalRef.current = true;
        fire("abandoned", {
          durationMs: Date.now() - startedAtRef.current,
          stepsSkipped: Math.max(
            0,
            ctxRef.current.params.totalSteps - stepsFired.current.size,
          ),
        });
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      onBeforeUnload();
    };
  }, [fire]);

  return { trackShown, trackStarted, trackStepCompleted, trackSkipped, trackCompleted };
}
