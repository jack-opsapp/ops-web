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
 *    (add a row, fill it, accept), TEMPLATE (pick your trade → starter cards),
 *    and UPLOAD (drop a CSV → auto-route → map → dedupe-bind → stage); QuickBooks
 *    and the guided agent land in their own phases and appear in the picker as
 *    they do.
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
import { useCatalogSetupLock } from "@/lib/hooks/use-catalog-setup-lock";
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
import { commitsHeld, resolveDriver } from "@/lib/catalog-setup/agent-fallback";
import { buildStepPlan, type StepContext } from "@/lib/catalog-setup/step-machine";
import { entryAllowed, isStepAccessible } from "@/lib/catalog-setup/step-gates";
import { deriveBlockingPrerequisite } from "@/lib/catalog-setup/prerequisites";
import { blankCard } from "@/lib/catalog-setup/blank-cards";
import { selectTradeTemplate } from "@/lib/catalog-setup/trade-templates";
import type { WizardTradeId } from "@/lib/catalog-setup/trade-list";
import { parseCsv } from "@/lib/catalog-setup/csv-parse";
import { parseXlsx } from "@/lib/catalog-setup/xlsx-parse";
import { buildUploadCards } from "@/lib/catalog-setup/upload-stage";
import { toExistingCatalog } from "@/lib/catalog-setup/existing-rows";
import {
  catalogCommitToastMessage,
  commitCountPhrase,
} from "@/lib/catalog-setup/commit/completion-notification";
import { SetupWizardShell } from "@/components/catalog-setup/setup-wizard-shell";
import { OfflineBanner } from "@/components/catalog-setup/offline-banner";
import {
  PrerequisiteGate,
  GatePanel,
} from "@/components/catalog-setup/prerequisite-gate";
import { InventoryOffPrompt } from "@/components/catalog-setup/inventory-off-prompt";
import { useSetInventoryMode } from "@/lib/hooks/use-set-inventory-mode";
import { useCatalogLookups } from "@/lib/hooks/use-catalog-lookups";
import { useCatalogSetupExistingRows } from "@/lib/hooks/use-catalog-setup-existing-rows";
import { useQuickBooksCatalogPull } from "@/lib/hooks/use-quickbooks-catalog-pull";
import { useInitiateOAuth } from "@/lib/hooks/use-accounting";
import { AccountingProvider } from "@/lib/types/pipeline";
import type { SetupSource } from "@/components/catalog-setup/DriverPane";
import type { UploadPaneOutcome } from "@/components/catalog-setup/UploadPane";
import type {
  QuickBooksPaneStatus,
  QuickBooksPaneSummary,
} from "@/components/catalog-setup/QuickBooksPane";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";

/**
 * Lanes wired end-to-end. The guided "describe" (agent) lane appears only when
 * it's configured (NEXT_PUBLIC_CATALOG_AGENT_ENABLED + a server OPENAI_API_KEY) —
 * honest, never a lane that 503s. TEMPLATE (per-trade starter) + MANUAL are the
 * always-available deterministic floor (offline / no-agent safe). More lanes
 * (file upload, QuickBooks) join as their phases land.
 */
const AGENT_ENABLED = process.env.NEXT_PUBLIC_CATALOG_AGENT_ENABLED === "true";
const AVAILABLE_SOURCES: SetupSource[] = AGENT_ENABLED
  ? ["describe", "upload", "template", "manual"]
  : ["upload", "template", "manual"];

// QuickBooks read-only pull lane. DARK BY DEFAULT — the button appears only when
// the client flag is set (the server route is independently gated + Canpro-scoped;
// broad enablement is gated on the plaintext-token remediation). Appended (not
// edited into the literal above) so it stays an isolated, idempotent addition.
const QB_IMPORT_ENABLED = process.env.NEXT_PUBLIC_CATALOG_QB_IMPORT_ENABLED === "true";
if (QB_IMPORT_ENABLED && !AVAILABLE_SOURCES.includes("quickbooks")) {
  AVAILABLE_SOURCES.push("quickbooks");
}

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
  const lock = useCatalogSetupLock();
  const online = useOnlineStatus();
  const commit = useCommitCatalogSetup();
  const agent = useSetupAgent();
  const setInventoryMode = useSetInventoryMode();
  const { categories, units } = useCatalogLookups();
  const { data: existingProductRows } = useCatalogSetupExistingRows();
  const qbPull = useQuickBooksCatalogPull();
  const initiateOAuth = useInitiateOAuth();
  const [driverMode, setDriverMode] = useState<
    "picker" | "trade-picker" | "upload" | "quickbooks" | "conversation"
  >("picker");
  // QuickBooks lane view-state (the route owns the lifecycle; the pane renders it).
  const [qbStatus, setQbStatus] = useState<QuickBooksPaneStatus>("ready");
  const [qbSummary, setQbSummary] = useState<QuickBooksPaneSummary | null>(null);
  const [qbErrorKind, setQbErrorKind] = useState<"generic" | "reconnect">("generic");
  const [turns, setTurns] = useState<string[]>([]);
  // Once the agent fails mid-session, it stays failed for the session: the driver
  // falls to the deterministic guided path and the "describe" lane is withdrawn so
  // the owner can't re-hit a broken agent (spec §16 "agent failure mid-session").
  const [agentErrored, setAgentErrored] = useState(false);
  const [inventoryPromptOpen, setInventoryPromptOpen] = useState(false);
  const inventoryPromptShownRef = useRef(false);

  // ── Gates + analytics context (computed unconditionally — rules of hooks) ────
  // step-gates is the single source for which modules this operator can run;
  // the StepContext (rail) + analytics totalSteps both derive from it, so the
  // route never re-implements the permission matrix.
  const allowed = entryAllowed(can);
  const tracked = inventory?.tracked ?? false;

  // The agent drives only while online, enabled, and not already failed this
  // session; otherwise the deterministic lanes take over and "describe" is hidden
  // so the lane is never a dead 503/repeat-failure (agent-fallback contract).
  const agentDriver = resolveDriver({
    online,
    agentEnabled: AGENT_ENABLED,
    agentErrored,
  });
  const availableSources = useMemo(
    () =>
      agentDriver === "agent"
        ? AVAILABLE_SOURCES
        : AVAILABLE_SOURCES.filter((s) => s !== "describe"),
    [agentDriver],
  );

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

  // ── File-upload dedupe inputs (spec §11) ─────────────────────────────────────
  // The live product rows feed BOTH the show-diff matcher (liveRows) and the
  // canvas's on-file diff (existingRows), derived once from the same read so a
  // re-import MERGES instead of double-creating.
  const { liveRows, existingRows } = useMemo(
    () => toExistingCatalog(existingProductRows ?? []),
    [existingProductRows],
  );

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
      } else if (source === "template") {
        // Open the per-trade TEMPLATE sub-flow (pick trade → starter cards). No
        // cards staged until the owner confirms a trade.
        setDriverMode("trade-picker");
      } else if (source === "upload") {
        // Open the file-upload lane (drop a CSV → auto-route → map → stage).
        setDriverMode("upload");
      } else if (source === "quickbooks") {
        // Open the QuickBooks read-only pull lane (Canpro is connected → ready;
        // the PULL action drives the connection check + draw).
        setQbStatus("ready");
        setDriverMode("quickbooks");
      } else if (source === "describe") {
        // Open the guided conversation; the live input drives the agent.
        setDriverMode("conversation");
      }
    },
    [dispatch, analytics],
  );

  // TEMPLATE lane confirm: stage the trade's starter cards (trade + task types +
  // SELL seeds, all "proposed") onto the canvas, then drop into the live-building
  // view so the owner trims/accepts like any other source (spec §7/§8/§9).
  const onPickTrade = useCallback(
    (trade: WizardTradeId) => {
      dispatch({ type: "ADD_CARDS", cards: selectTradeTemplate(trade) });
      setDriverMode("conversation");
    },
    [dispatch],
  );

  // UPLOAD lane: read the file, auto-route (clean CSV/XLSX → deterministic
  // mapper), map → dedupe-bind against the live catalog → stage onto the canvas.
  // CSV parses inline; .xlsx/.xls lazy-loads SheetJS (parseXlsx) only on demand.
  // A file we can't auto-read returns an honest "save as CSV or add by hand"
  // outcome (doc/photo agent extraction is a separate lane).
  const onUpload = useCallback(
    async (file: File): Promise<UploadPaneOutcome> => {
      analytics.trackStarted();
      const lower = file.name.toLowerCase();
      const isXlsx = lower.endsWith(".xlsx") || lower.endsWith(".xls");
      const isCsv = lower.endsWith(".csv") || file.type.includes("csv");
      const sheet = isCsv
        ? parseCsv(await file.text())
        : isXlsx
          ? await parseXlsx(await file.arrayBuffer())
          : null;
      const result = buildUploadCards({
        filename: file.name,
        mime: file.type,
        sheet,
        categories,
        units,
        liveProductRows: liveRows,
      });
      if (result.lane === "agent") {
        return { kind: "cant_read" };
      }
      if (result.errors.length > 0) {
        return { kind: "errors", errors: result.errors.map((e) => e.reason) };
      }
      if (result.cards.length > 0) {
        dispatch({ type: "ADD_CARDS", cards: result.cards });
      }
      return {
        kind: "staged",
        staged: result.cards.length,
        merged: result.mergedCount,
        rowsRead: result.rowsRead,
        read: result.read,
      };
    },
    [analytics, categories, units, liveRows, dispatch],
  );

  // A can't-read file → seed a manual SELL row and drop into the canvas, so the
  // lane is never a dead end (spec §16: every path has a next move).
  const onUploadAddManually = useCallback(() => {
    dispatch({ type: "ADD_CARDS", cards: [blankCard("sell")] });
    setDriverMode("conversation");
  }, [dispatch]);

  // QUICKBOOKS lane: read-only pull → map → dedupe-bind (server-side) → stage the
  // proposed/merge cards onto the canvas. A missing/inactive connection or stale
  // token resolves to a connect/reconnect state (never an error toast); the merge
  // cards reuse the shell's existingRows (keyed by product id) for the show-diff.
  const onPullQuickBooks = useCallback(() => {
    if (qbPull.isPending) return;
    analytics.trackStarted();
    setQbStatus("pulling");
    qbPull.mutate(undefined, {
      onSuccess: (res) => {
        if (!res.connected) {
          setQbErrorKind(res.reconnect ? "reconnect" : "generic");
          setQbStatus(res.reconnect ? "error" : "connect");
          return;
        }
        if (res.cards.length > 0) {
          dispatch({ type: "ADD_CARDS", cards: res.cards });
        }
        setQbSummary({
          pulled: res.summary.staged,
          matched: res.summary.matched,
          blockers: res.summary.blockers,
          needsReview: res.summary.needsReview,
        });
        setQbStatus("result");
      },
      onError: () => {
        setQbErrorKind("generic");
        setQbStatus("error");
      },
    });
  }, [qbPull, analytics, dispatch]);

  // Connect / reconnect → the existing accounting OAuth (navigates to Intuit; the
  // owner returns and re-enters the wizard). Read-only pull only — never push.
  const onConnectQuickBooks = useCallback(() => {
    if (!company?.id) return;
    initiateOAuth.mutate({ companyId: company.id, provider: AccountingProvider.QuickBooks });
  }, [initiateOAuth, company]);

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
            // Either failure mode withdraws the agent for the rest of the session
            // and drops the owner back to the deterministic source picker — no
            // re-hitting a broken/unavailable agent.
            setAgentErrored(true);
            setDriverMode("picker");
            toast.error(
              err instanceof AgentUnavailableError
                ? t("agent.unavailable", "Guided setup is unavailable — add manually")
                : t("agent.error", "Couldn't generate — switched to guided setup"),
            );
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
          // Products/stock are live, but a degraded TYPES commit returns ok:true
          // with a warning — surface it honestly instead of a silent clean success.
          if (res.warnings?.includes("types_commit_failed")) {
            toast.warning(
              t(
                "commitTypesWarning",
                "Catalog's live — task types didn't save. Re-run setup to add them.",
              ),
            );
          }
          reset();
          window.sessionStorage.removeItem(SESSION_KEY);
          router.push("/catalog");
        },
        onError: (err) => {
          // A scope-guard failure means this account isn't fully provisioned for
          // catalog writes (its firebase_uid/auth_id resolves no company) — surface
          // an actionable state, not the raw RPC text (spec §16 next-move rule).
          if (
            err instanceof CommitError &&
            err.blockers.some((b) => b.code === "company_scope_mismatch")
          ) {
            toast.error(
              t(
                "commitScopeMismatch",
                "Your account isn't set up for catalog changes yet — ask your admin to finish your setup.",
              ),
            );
            return;
          }
          const detail =
            err instanceof CommitError && err.blockers.length
              ? err.blockers
                  .map((b) => b.message ?? b.code)
                  .filter(Boolean)
                  .join(" · ")
              : err.message;
          // Sequential per-transaction calls: some may be live even on failure.
          // Lead with what saved so we never imply "nothing saved" over live rows.
          const partial =
            err instanceof CommitError ? err.partial : undefined;
          const savedPhrase = partial ? commitCountPhrase(partial) : "";
          if (savedPhrase) {
            toast.error(
              t("commitPartial", "Saved {saved}. Some items need a fix — build again.").replace(
                "{saved}",
                savedPhrase,
              ),
            );
          } else {
            toast.error(detail || t("commitError", "Catalog commit failed"));
          }
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

  // Single-session lock — another live setup session in this company already
  // holds it (spec §16). Calm panel, never a crash. Optimistic until the first
  // probe resolves (ready); fail-open so the lock can only ever ADD this panel.
  if (lock.ready && lock.heldByOther) {
    return (
      <GatePanel
        reason="session_locked"
        onReload={() => window.location.reload()}
        onExit={() => router.push("/catalog")}
      />
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
        existingRows={existingRows}
        driverMode={driverMode}
        availableSources={availableSources}
        onPickSource={onPickSource}
        onPickTrade={onPickTrade}
        onUpload={onUpload}
        onUploadAddManually={onUploadAddManually}
        qbStatus={qbStatus}
        qbSummary={qbSummary}
        qbErrorKind={qbErrorKind}
        onPullQuickBooks={onPullQuickBooks}
        onConnectQuickBooks={onConnectQuickBooks}
        onSwitchToGuided={() => setDriverMode("picker")}
        onSend={agentDriver === "agent" ? onSend : undefined}
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
