"use client";

/**
 * SetupWizardShell — the full-page command deck for the catalog-setup wizard.
 *
 * Composes every built piece into one surface (foundations + canvas + left
 * slices): the ModuleRail, the CanvasPane (RunningTotals + StagingCardView
 * lists), the DriverPane, the ItemEditor, the store, the selectors, the
 * step-machine, the motion module, and the i18n dictionary. It owns NO staging
 * logic — that all lives in the reducer/store; the shell only owns layout, the
 * single primary CTA, and the master-detail selection that swaps the left pane
 * to the ItemEditor when a card is sent to edit.
 *
 * ── DESIGN JUDGMENT (root CLAUDE.md law — every element justified) ────────────
 *  • Two panes, not three columns: the operator is doing ONE thing — assembling
 *    a catalog. The driver (or the editor of the card they're shaping) sits left;
 *    the live result sits right. Master-detail, not a dashboard of options.
 *  • ONE primary action. Catalog setup resolves to a single verb: build it. That
 *    verb gets the lone steel-accent element on the screen — outlined at rest,
 *    fills bg-ops-accent text-black on hover. Everything else stays neutral
 *    (the rail, the exit, every card, every chip). Accent is exclusivity.
 *  • The CTA is never a dead end. When it can't commit, it disables AND says
 *    exactly why (selectBlockers → "// N ROWS NEED A PRICE" / "// N ROWS NEED A
 *    NAME"), so the owner always knows the next move — never a greyed button with
 *    no reason. When it CAN commit, the caption says what it'll do ("adds N to
 *    your catalog — nothing goes live until you build").
 *  • [ set up later ] is a ghost, not a button. Once-ever setup never owns prime
 *    space, and abandoning is safe — the store persists the in-progress canvas,
 *    nothing commits until build (spec §11). So leaving costs the owner nothing.
 *  • STATE-AWARE: STOCK drops out of both the rail and the canvas when inventory
 *    isn't tracked — the deck shows the operator's actual reality, never a step
 *    they'll never touch (step-machine buildStepPlan).
 *
 * ── MOTION (animation-architect → web-animations; EASE_SMOOTH, no spring) ─────
 *  • Left-pane swap (DriverPane ⇄ ItemEditor) is the TRANSITION beat — the panes
 *    crossfade/slide via AnimatePresence mode="wait". DriverPane and ItemEditor
 *    each own their own entry choreography + reduced-motion fallback; the shell
 *    only sequences them. Under reduced motion the swap is an opacity-only
 *    crossfade (the children already branch on useReducedMotion()).
 *  • The CTA fill is a 150ms color transition (hover), not a motion component —
 *    a button hover is Tier-1 CSS, no JS animation needed.
 *
 * VOICE: `//` slash for the deck eyebrow + blocker readout, [brackets] for the
 * build caption + exit, UPPERCASE authority for the CTA, sentence case for
 * content. Numbers mono/tabular. Strings via useDictionary("catalog-setup").
 */

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import {
  selectByModule,
  selectRunningTotals,
  selectBlockers,
  type Blocker,
} from "@/lib/catalog-setup/selectors";
import type { StagingState } from "@/lib/catalog-setup/staging-reducer";
import type { StepContext } from "@/lib/catalog-setup/step-machine";
import type { OnFileProduct } from "@/lib/catalog-setup/existing-rows";
import { blankCard } from "@/lib/catalog-setup/blank-cards";
import type { WizardTradeId } from "@/lib/catalog-setup/trade-list";
import { ModuleRail } from "./ModuleRail";
import { CanvasPane } from "./CanvasPane";
import { DriverPane, type SetupSource } from "./DriverPane";
import { ItemEditor } from "./ItemEditor";
import { UploadPane, type UploadPaneOutcome } from "./UploadPane";
import {
  QuickBooksPane,
  type QuickBooksPaneStatus,
  type QuickBooksPaneSummary,
} from "./QuickBooksPane";

const MONO_NUM: React.CSSProperties = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

/** Type-safety fallback when the shell renders standalone (preview) without an
 *  upload handler — the upload lane is only reachable via the route, which always
 *  passes a real `onUpload`. */
const NOOP_UPLOAD = async (): Promise<UploadPaneOutcome> => ({ kind: "cant_read" });

export interface SetupWizardShellProps {
  /**
   * Step/permission gating for the rail (STOCK omitted when inventory isn't
   * tracked). Defaults to the all-permissions, tracked-inventory case so the
   * standalone preview renders the full rail.
   */
  context?: StepContext;
  /** Whether the STOCK canvas section + rail segment render (state-aware). */
  inventoryTracked?: boolean;
  /** On-file values a merge (duplicate) card matched, keyed by id. */
  existingRows?: Record<string, OnFileProduct>;
  /** The commit. Wired to the convert/commit pipeline after rebase; the preview
   *  passes a no-op so the disabled/enabled states still demo. */
  onBuild?: () => void;
  /** The ghost exit. Routes away from setup; preview leaves it undefined. */
  onSetupLater?: () => void;
  /**
   * Left-pane driver state when no card is being edited: "picker" shows the
   * source picker ("How do you want to start?"); "trade-picker" shows the
   * per-trade TEMPLATE sub-flow; "upload" shows the file-upload lane;
   * "quickbooks" shows the QuickBooks read-only pull lane; "conversation" shows
   * the guided-setup transcript. Defaults to "conversation".
   */
  driverMode?: "picker" | "trade-picker" | "upload" | "quickbooks" | "conversation";
  /** Source chosen in the picker (pre-conversation). */
  onPickSource?: (source: SetupSource) => void;
  /** Trade confirmed in the TEMPLATE sub-flow → stages that trade's starter cards. */
  onPickTrade?: (trade: WizardTradeId) => void;
  /** File-upload lane: parse + stage a dropped file (resolves to the pane's outcome). */
  onUpload?: (file: File) => Promise<UploadPaneOutcome>;
  /** File-upload lane: a can't-read file → seed a manual entry instead. */
  onUploadAddManually?: () => void;
  /** QuickBooks lane: pull lifecycle (checking/connect/ready/pulling/result/error). */
  qbStatus?: QuickBooksPaneStatus;
  /** QuickBooks lane: counts surfaced after a successful pull. */
  qbSummary?: QuickBooksPaneSummary | null;
  /** QuickBooks lane: transient failure (retry) vs stale token (reconnect). */
  qbErrorKind?: "generic" | "reconnect";
  /** QuickBooks lane: run the read-only pull. */
  onPullQuickBooks?: () => void;
  /** QuickBooks lane: connect / reconnect via the accounting OAuth. */
  onConnectQuickBooks?: () => void;
  /** Restrict the source picker to the lanes wired end-to-end (omit → all). */
  availableSources?: SetupSource[];
  /** Offline / declined → hand off to the deterministic guided path. */
  onSwitchToGuided?: () => void;
  /** Submit a description to the Setup Agent (conversation mode). */
  onSend?: (text: string) => void;
  /** Agent generating — disables the input + shows the "on it" turn. */
  agentBusy?: boolean;
  /** Real conversation turns (owner messages), oldest first. */
  conversationTurns?: string[];
  className?: string;
}

const DEFAULT_CONTEXT: StepContext = {
  inventoryTracked: true,
  canSell: true,
  canStock: true,
  canTypes: true,
};

/**
 * Resolve the precise, localized reason the CTA is disabled from the first
 * blocker (spec §16). One reason at a time — the operator fixes it, the next
 * surfaces. Returns null when nothing blocks the build.
 */
function blockerReason(
  blocker: Blocker | undefined,
  t: ReturnType<typeof useDictionary>["t"],
): string | null {
  if (!blocker) return null;
  if (blocker.kind === "missing_price") {
    return t("build.blocker.price", "// {count} rows need a price").replace(
      "{count}",
      String(blocker.count),
    );
  }
  return t("build.blocker.name", "// {count} rows need a name").replace(
    "{count}",
    String(blocker.count),
  );
}

export function SetupWizardShell({
  context = DEFAULT_CONTEXT,
  inventoryTracked,
  existingRows,
  onBuild,
  onSetupLater,
  driverMode = "conversation",
  onPickSource,
  onPickTrade,
  onUpload,
  onUploadAddManually,
  qbStatus,
  qbSummary,
  qbErrorKind,
  onPullQuickBooks,
  onConnectQuickBooks,
  availableSources,
  onSwitchToGuided,
  onSend,
  agentBusy,
  conversationTurns,
  className,
}: SetupWizardShellProps) {
  const { t } = useDictionary("catalog-setup");

  // ── State from the store (selectors re-derive on every render) ──────────────
  const cards = useCatalogSetupStore((s) => s.cards);
  const currentStep = useCatalogSetupStore((s) => s.currentStep);
  const dispatch = useCatalogSetupStore((s) => s.dispatch);

  // ── Master-detail SELECTION — local to the shell ────────────────────────────
  // The "which card is being edited" choice is transient view state, not staging
  // state. It lives here (not in the persisted store) so an abandoned edit never
  // survives a refresh and the shared store stays scoped to the resumable canvas.
  const [editingId, setEditingId] = useState<string | null>(null);
  const startEditing = useCallback((id: string) => setEditingId(id), []);
  const stopEditing = useCallback(() => setEditingId(null), []);

  const state: StagingState = useMemo(() => ({ cards }), [cards]);
  const byModule = useMemo(() => selectByModule(state), [state]);
  const totals = useMemo(() => selectRunningTotals(state), [state]);
  const blockers = useMemo(() => selectBlockers(state), [state]);

  // STATE-AWARE: prefer the explicit prop, else the context flag (rail + canvas
  // must agree on whether STOCK exists).
  const tracked = inventoryTracked ?? context.inventoryTracked;
  const railContext: StepContext = useMemo(
    () => ({ ...context, inventoryTracked: tracked }),
    [context, tracked],
  );

  // Proposed-count-per-module drives the rail's hollow upcoming circles.
  const counts = useMemo(
    () => ({
      sell: byModule.sell.filter((c) => c.state === "proposed").length,
      stock: byModule.stock.filter((c) => c.state === "proposed").length,
      types: byModule.types.filter((c) => c.state === "proposed").length,
    }),
    [byModule],
  );

  // ── The single primary CTA's committability + precise disabled reason ────────
  const reason = blockerReason(blockers[0], t);
  // Committable when there is at least one "added" row AND nothing blocks it.
  const canBuild = totals.added > 0 && blockers.length === 0;
  const disabledReason: string | null = reason
    ? reason
    : totals.added === 0
      ? t("build.empty", "[accept at least one card to build]")
      : null;

  // ── Master-detail: the card under edit (if any) drives the left pane swap ────
  const editingCard = useMemo(
    () => (editingId ? cards.find((c) => c.id === editingId) ?? null : null),
    [editingId, cards],
  );

  return (
    <div
      data-testid="setup-wizard-shell"
      className={cn(
        "flex h-full min-h-0 w-full flex-col bg-background",
        className,
      )}
    >
      {/* ── HEADER STRIP — eyebrow, rail, + the two actions ─────────────────── */}
      <header
        data-testid="wizard-header"
        className="flex shrink-0 flex-col gap-4 border-b border-glass-border px-[44px] py-[28px]"
      >
        <div className="flex items-start justify-between gap-6">
          {/* Eyebrow — Cake Mono display title + bracket subtitle */}
          <div className="min-w-0">
            <h1 className="font-cakemono text-[22px] font-light uppercase leading-none text-text">
              <span aria-hidden className="mr-[8px] font-mono text-[18px] text-text-mute">
                //
              </span>
              {t("title", "// your operating system").replace(/^\/\/\s*/, "")}
            </h1>
            <p className="mt-2 max-w-[60ch] font-mono text-micro tracking-wide text-text-3">
              {t(
                "subtitle",
                "[everything you sell, stock, and schedule — built once, used everywhere]",
              )}
            </p>
          </div>

          {/* Actions — ghost exit (left of) the single primary CTA */}
          <div className="flex shrink-0 items-center gap-4">
            <button
              type="button"
              data-testid="wizard-setup-later"
              onClick={onSetupLater}
              className="font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
            >
              {t("build.later", "[ set up later ]")}
            </button>

            {/* The ONE ops-accent element on the screen. Outlined at rest →
                fills bg-ops-accent text-black on hover. Disabled carries a
                precise reason via title + aria-describedby. */}
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                data-testid="wizard-build-it"
                onClick={onBuild}
                disabled={!canBuild}
                aria-describedby={
                  disabledReason ? "wizard-build-reason" : undefined
                }
                title={disabledReason ?? undefined}
                className={cn(
                  "rounded-[5px] border px-6 py-2 font-cakemono text-[14px] font-light uppercase tracking-wide transition-colors duration-150",
                  canBuild
                    ? "border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                    : "cursor-not-allowed border-glass-border text-text-mute",
                )}
              >
                {t("build.cta", "BUILD IT")}
              </button>

              {/* Caption / precise blocker reason. Reason is mono `//` voice
                  (a system readout); the ready caption is bracket micro-text. */}
              {disabledReason ? (
                <span
                  id="wizard-build-reason"
                  data-testid="wizard-build-reason"
                  role="status"
                  className={cn(
                    "max-w-[28ch] text-right font-mono text-micro tracking-wide",
                    reason ? "text-tan" : "text-text-3",
                  )}
                  style={reason ? MONO_NUM : undefined}
                >
                  {disabledReason}
                </span>
              ) : (
                <span
                  data-testid="wizard-build-caption"
                  className="max-w-[28ch] text-right font-mono text-micro tracking-wide text-text-3"
                  style={MONO_NUM}
                >
                  {t(
                    "build.caption",
                    "[adds {count} to your catalog — nothing goes live until you build]",
                  ).replace("{count}", String(totals.added))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Rail — neutral status line, STOCK state-aware */}
        <ModuleRail currentStep={currentStep} context={railContext} counts={counts} />
      </header>

      {/* ── BODY — left pane (driver | editor) + right pane (canvas) ─────────── */}
      <div
        data-testid="wizard-body"
        className="grid min-h-0 flex-1 grid-cols-1 gap-6 px-[44px] py-[28px] lg:grid-cols-[minmax(360px,420px)_1fr]"
      >
        {/* LEFT — master-detail. DriverPane by default; ItemEditor when a card
            is selected for edit. AnimatePresence mode="wait" sequences the swap
            (TRANSITION beat); each pane owns its reduced-motion fallback. */}
        <div data-testid="wizard-left-pane" className="flex min-h-0 flex-col">
          <AnimatePresence mode="wait" initial={false}>
            {editingCard ? (
              <ItemEditor
                key={`editor-${editingCard.id}`}
                card={editingCard}
                onBack={stopEditing}
                onDone={stopEditing}
                onEditField={(fields) =>
                  dispatch({ type: "EDIT_CARD", id: editingCard.id, fields })
                }
                className="min-h-0 flex-1"
              />
            ) : driverMode === "upload" ? (
              <UploadPane
                key="upload"
                onUpload={onUpload ?? NOOP_UPLOAD}
                onAddManually={onUploadAddManually}
                onBack={onSwitchToGuided}
                className="min-h-0 flex-1"
              />
            ) : driverMode === "quickbooks" ? (
              <QuickBooksPane
                key="quickbooks"
                status={qbStatus ?? "ready"}
                summary={qbSummary}
                errorKind={qbErrorKind}
                onPull={onPullQuickBooks}
                onConnect={onConnectQuickBooks}
                onBack={onSwitchToGuided}
                className="min-h-0 flex-1"
              />
            ) : (
              <DriverPane
                key="driver"
                mode={driverMode}
                onPickSource={onPickSource}
                onPickTrade={onPickTrade}
                availableSources={availableSources}
                onSwitchToGuided={onSwitchToGuided}
                onSend={onSend}
                busy={agentBusy}
                turns={conversationTurns}
                className="min-h-0 flex-1"
              />
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT — the live-building canvas */}
        <CanvasPane
          byModule={byModule}
          totals={totals}
          inventoryTracked={tracked}
          existingRows={existingRows}
          callbacks={{
            onAccept: (id) => dispatch({ type: "ACCEPT_CARD", id }),
            onReject: (id) => dispatch({ type: "REJECT_CARD", id }),
            onEdit: (id) => startEditing(id),
            // TAKE INCOMING (bulk): re-bind + clear any per-field verdicts back to
            // the incoming-wins default — overwrite every changed field. KEEP ON
            // FILE (bulk) is handled in-card by setting every verdict to keep, so
            // it never destructively drops the card.
            onMerge: (id) =>
              dispatch({
                type: "MERGE_CARD",
                id,
                matchedExistingId:
                  cards.find((c) => c.id === id)?.matchedExistingId ?? "",
              }),
            // Per-field verdict on a merge card (take incoming / keep on file).
            onToggleDiffField: (id, field, accepted) =>
              dispatch({ type: "SET_FIELD_SELECTION", id, field, accepted }),
          }}
          onAddRow={(module) => {
            const card = blankCard(module);
            dispatch({ type: "ADD_CARDS", cards: [card] });
            // Open the new blank row straight into the editor to fill it.
            startEditing(card.id);
          }}
          className="min-h-0"
        />
      </div>
    </div>
  );
}

export default SetupWizardShell;
