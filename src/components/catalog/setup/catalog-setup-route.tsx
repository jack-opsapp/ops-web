"use client";

/**
 * CatalogSetupRoute — the client surface behind /catalog/setup. Mounts the real,
 * Jackson-approved SetupWizardShell and wires it to live data + the commit
 * pipeline:
 *
 *  • permission: gated on catalog.run_setup — renders `// NO ACCESS` otherwise
 *    (defense-in-depth; the route's layout gate + the RPC scope guard also apply).
 *  • inventoryTracked: read from company_inventory_settings (STOCK module is
 *    state-aware — hidden until inventory is on).
 *  • onBuild: commits the accepted cards via catalog_setup_save, toasts the
 *    result, resets the canvas, and returns to the now-populated /catalog.
 *  • onSetupLater: the ghost exit → back to /catalog.
 *  • sources: scoped to the lanes wired end-to-end. This slice ships MANUAL
 *    (add a row, fill it, accept); QuickBooks / file upload / template / the
 *    guided agent land in their own phases and appear in the picker as they do.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { SubscriptionStatus } from "@/lib/types/models";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import { useInventoryMode } from "@/lib/hooks/use-inventory-mode";
import { useBaselineSeeded } from "@/lib/hooks/use-baseline-seeded";
import { useOnlineStatus } from "@/lib/hooks/use-online-status";
import { useCatalogSetupAnalytics } from "@/lib/hooks/use-catalog-setup-analytics";
import {
  CommitError,
  useCommitCatalogSetup,
} from "@/lib/hooks/use-commit-catalog-setup";
import {
  AgentUnavailableError,
  useSetupAgent,
} from "@/lib/hooks/use-setup-agent";
import { commitsHeld } from "@/lib/catalog-setup/agent-fallback";
import { buildStepPlan, type StepContext } from "@/lib/catalog-setup/step-machine";
import { entryAllowed, isStepAccessible } from "@/lib/catalog-setup/step-gates";
import { deriveBlockingPrerequisite } from "@/lib/catalog-setup/prerequisites";
import { blankCard } from "@/lib/catalog-setup/blank-cards";
import { catalogCommitToastMessage } from "@/lib/catalog-setup/commit/completion-notification";
import { SetupWizardShell } from "@/components/catalog-setup/setup-wizard-shell";
import { OfflineBanner } from "@/components/catalog-setup/offline-banner";
import { PrerequisiteGate } from "@/components/catalog-setup/prerequisite-gate";
import { InventoryOffPrompt } from "@/components/catalog-setup/inventory-off-prompt";
import { useSetInventoryMode } from "@/lib/hooks/use-set-inventory-mode";
import type { SetupSource } from "@/components/catalog-setup/DriverPane";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";

/**
 * Lanes wired end-to-end. The guided "describe" (agent) lane appears only when
 * it's configured (NEXT_PUBLIC_CATALOG_AGENT_ENABLED + a server OPENAI_API_KEY) —
 * honest, never a lane that 503s. Manual is always the floor. More lanes
 * (file upload, template, QuickBooks) join as their phases land.
 */
const AGENT_ENABLED = process.env.NEXT_PUBLIC_CATALOG_AGENT_ENABLED === "true";
const AVAILABLE_SOURCES: SetupSource[] = AGENT_ENABLED
  ? ["describe", "manual"]
  : ["manual"];

const SESSION_KEY = "ops-catalog-setup-session-id";

/**
 * Stable per-tab session id → a replay-safe idempotency key for the commit.
 * sessionStorage survives a refresh, so retrying the same accepted set reuses
 * the key (the RPC dedupes) rather than minting a fresh one per click.
 */
function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let v = window.sessionStorage.getItem(SESSION_KEY);
  if (!v) {
    v = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, v);
  }
  return v;
}

export function CatalogSetupRoute() {
  const { t } = useDictionary("catalog-setup");
  const router = useRouter();
  const can = usePermissionStore((s) => s.can);
  const company = useAuthStore((s) => s.company);
  const cards = useCatalogSetupStore((s) => s.cards);
  const dispatch = useCatalogSetupStore((s) => s.dispatch);
  const reset = useCatalogSetupStore((s) => s.reset);
  const { data: inventory } = useInventoryMode();
  const { data: baseline } = useBaselineSeeded();
  const online = useOnlineStatus();
  const commit = useCommitCatalogSetup();
  const agent = useSetupAgent();
  const setInventoryMode = useSetInventoryMode();
  const [driverMode, setDriverMode] = useState<"picker" | "conversation">(
    "picker",
  );
  const [turns, setTurns] = useState<string[]>([]);
  const [inventoryPromptOpen, setInventoryPromptOpen] = useState(false);
  const inventoryPromptShownRef = useRef(false);

  // ── Gates + analytics context (computed unconditionally — rules of hooks) ────
  // step-gates is the single source for which modules this operator can run;
  // the StepContext (rail) + analytics totalSteps both derive from it, so the
  // route never re-implements the permission matrix.
  const allowed = entryAllowed(can);
  const tracked = inventory?.tracked ?? false;

  // ── Prerequisite gate (spec §16) — never a crash, always a calm reason ───────
  // companyExists + baselineSeeded are the live signals that actually gate a
  // brand-new / mid-provisioning company. The catalog surface is, by
  // construction, deployed when this route renders (it lives inside /catalog),
  // and an expired-subscription lockout is enforced app-wide before any
  // dashboard route — both are defensive here. Inputs fail OPEN while loading
  // (baseline undefined → treated present) so a legitimate operator never sees a
  // flash of the gate.
  const blocker = useMemo(
    () =>
      deriveBlockingPrerequisite({
        companyExists: !!company?.id,
        baselineSeeded: baseline ?? true,
        catalogSurfaceDeployed: true,
        subscriptionLocked:
          company?.subscriptionStatus === SubscriptionStatus.Expired ||
          company?.subscriptionStatus === SubscriptionStatus.Cancelled,
      }),
    [company?.id, company?.subscriptionStatus, baseline],
  );

  const context: StepContext = useMemo(
    () => ({
      inventoryTracked: tracked,
      canSell: isStepAccessible("SELL", can),
      canStock: isStepAccessible("STOCK", can),
      canTypes: isStepAccessible("TYPES", can),
    }),
    [tracked, can],
  );
  const totalSteps = useMemo(() => buildStepPlan(context).length, [context]);
  const sessionId = useMemo(() => getSessionId(), []);
  const analytics = useCatalogSetupAnalytics({
    sessionId,
    totalSteps,
    triggerType: "catalog_setup",
  });

  // shown: the wizard surface mounted (only for an operator who may run it).
  useEffect(() => {
    if (allowed) analytics.trackShown();
  }, [allowed, analytics]);

  // step_completed: fire once per module the moment it gains a committed card.
  useEffect(() => {
    for (const key of ["sell", "stock", "types"] as const) {
      const hasAdded = cards.some(
        (c) =>
          c.module === key &&
          (c.state === "accepted" || c.state === "edited" || c.state === "merge"),
      );
      if (hasAdded) analytics.trackStepCompleted(key);
    }
  }, [cards, analytics]);

  // ── Inventory-off prompt: stock arrived but tracking is off (spec §16) ───────
  // A one-time forced fork — turn tracking on (counts stay) or keep as products
  // (quantities surfaced via the down-shift, never silently dropped).
  const stockCardCount = useMemo(
    () => cards.filter((c) => c.module === "stock" && c.state !== "rejected").length,
    [cards],
  );
  useEffect(() => {
    if (!tracked && stockCardCount > 0 && !inventoryPromptShownRef.current) {
      inventoryPromptShownRef.current = true;
      setInventoryPromptOpen(true);
    }
  }, [tracked, stockCardCount]);

  const onTrackInventory = useCallback(() => {
    setInventoryMode.mutate("tracked", {
      onSuccess: () => {
        setInventoryPromptOpen(false);
        toast.success(t("inventoryOff.tracked", "Inventory tracking is on"));
      },
      onError: () =>
        toast.error(
          t("inventoryOff.trackError", "Couldn't turn on tracking — try again"),
        ),
    });
  }, [setInventoryMode, t]);

  const onKeepAsProducts = useCallback(() => {
    dispatch({ type: "DOWNSHIFT_STOCK_TO_PRODUCTS" });
    setInventoryPromptOpen(false);
    toast(t("inventoryOff.kept", "Kept as products — quantities shown on each"));
  }, [dispatch, t]);

  const onPickSource = useCallback(
    (source: SetupSource) => {
      analytics.trackStarted();
      if (source === "manual") {
        dispatch({ type: "ADD_CARDS", cards: [blankCard("sell")] });
        // Leave the picker — the canvas now holds a row to fill + accept.
        setDriverMode("conversation");
      } else if (source === "describe") {
        // Open the guided conversation; the live input drives the agent.
        setDriverMode("conversation");
      }
    },
    [dispatch, analytics],
  );

  const onSend = useCallback(
    (text: string) => {
      if (agent.isPending) return;
      analytics.trackStarted();
      const priorTurns = turns;
      setTurns((prev) => [...prev, text]);
      agent.mutate(
        { description: text, priorTurns },
        {
          onSuccess: (res) => {
            if (res.cards.length > 0) {
              dispatch({ type: "ADD_CARDS", cards: res.cards });
              toast.success(
                t("agent.added", "Added {n} — review and edit").replace(
                  "{n}",
                  String(res.cards.length),
                ),
              );
            } else {
              toast(
                t(
                  "agent.none",
                  "Couldn't pull anything from that — try describing what you sell",
                ),
              );
            }
          },
          onError: (err) => {
            if (err instanceof AgentUnavailableError) {
              toast.error(
                t("agent.unavailable", "Guided setup is unavailable — add manually"),
              );
              setDriverMode("picker");
            } else {
              toast.error(err.message || t("agent.error", "Couldn't generate — try again"));
            }
          },
        },
      );
    },
    [agent, turns, dispatch, t, analytics],
  );

  const onBuild = useCallback(() => {
    if (commit.isPending) return;
    // Hold the commit while offline — staged cards are safe client-side and the
    // build goes through once connectivity returns (spec §16).
    if (commitsHeld(online)) {
      toast.error(
        t("offline.held", "You're offline — your catalog is saved, build when you're back"),
      );
      return;
    }
    commit.mutate(
      { sessionId: getSessionId(), cards },
      {
        onSuccess: (res) => {
          analytics.trackCompleted();
          toast.success(catalogCommitToastMessage(res.counts));
          reset();
          window.sessionStorage.removeItem(SESSION_KEY);
          router.push("/catalog");
        },
        onError: (err) => {
          const detail =
            err instanceof CommitError && err.blockers.length
              ? err.blockers
                  .map((b) => b.message ?? b.code)
                  .filter(Boolean)
                  .join(" · ")
              : err.message;
          toast.error(detail || t("commitError", "Catalog commit failed"));
        },
      },
    );
  }, [commit, cards, reset, router, t, online, analytics]);

  const onSetupLater = useCallback(() => {
    analytics.trackSkipped();
    router.push("/catalog");
  }, [router, analytics]);

  // Permission gate — defense-in-depth. The tactical denied state mirrors
  // catalog-page.tsx's no-access treatment.
  if (!allowed) {
    return (
      <div
        data-testid="catalog-setup-denied"
        className="flex flex-col items-start px-[44px] py-12"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("denied", "NO ACCESS")}
        </span>
      </div>
    );
  }

  return (
    <PrerequisiteGate
      blocker={blocker}
      onReload={() => window.location.reload()}
      onExit={() => router.push("/catalog")}
    >
      <OfflineBanner online={online} className="mx-[44px] mt-[20px]" />
      <SetupWizardShell
        context={context}
        inventoryTracked={tracked}
        driverMode={driverMode}
        availableSources={AVAILABLE_SOURCES}
        onPickSource={onPickSource}
        onSwitchToGuided={() => setDriverMode("picker")}
        onSend={AGENT_ENABLED ? onSend : undefined}
        agentBusy={agent.isPending}
        conversationTurns={turns}
        onBuild={onBuild}
        onSetupLater={onSetupLater}
      />
      {/* One-time forced fork when stock arrives on an untracked company. No
          onOpenChange → the owner must choose (counts are never dropped). */}
      <InventoryOffPrompt
        open={inventoryPromptOpen}
        stockItemCount={stockCardCount}
        onTrack={onTrackInventory}
        onKeepAsProducts={onKeepAsProducts}
      />
    </PrerequisiteGate>
  );
}

export default CatalogSetupRoute;
