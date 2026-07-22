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
 *  • Left-pane swap (DriverPane ⇄ ItemEditor ⇄ Upload ⇄ QuickBooks) is the
 *    TRANSITION beat — a SINGLE keyed mount: the outgoing pane unmounts
 *    synchronously with the state change and the incoming pane fades in (each
 *    pane owns its 200ms entry + reduced-motion fallback). Deliberately NO
 *    AnimatePresence / exit choreography here: an exit-gated swap can wedge the
 *    whole left column behind an unfinished exit animation (nested mode="wait"
 *    did exactly that under load), and a first click that "does nothing" is a
 *    worse failure than a hard cut. The entry fade alone carries the beat.
 *
 * ── LAYOUT (must hold at a 13" laptop — 689px of viewport) ────────────────────
 *  • The header strip is two compact rows (section-tier title + inline subtitle,
 *    then rail + actions sharing one row) — every vertical pixel of chrome here
 *    is stolen from the working panes, so the strip stays under ~100px.
 *  • ≥768px: the two-pane command deck, panes hard-bounded (internal scroll with
 *    ScrollFade). <768px (half-screen windows, heavy zoom): normal document
 *    flow — the body stacks and page-scrolls, no fixed-height chain, so nothing
 *    can collapse to 0px or paint over a sibling.
 *  • The CTA fill is a 150ms color transition (hover), not a motion component —
 *    a button hover is Tier-1 CSS, no JS animation needed.
 *
 * VOICE: `//` slash for the deck eyebrow + blocker readout, [brackets] for the
 * build caption + exit, UPPERCASE authority for the CTA, sentence case for
 * content. Numbers mono/tabular. Strings via useDictionary("catalog-setup").
 */

import { useCallback, useMemo, useState } from "react";
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

  // "Add it yourself" behaves exactly like the canvas's `+ add` affordance: seed
  // a blank SELL row and open it straight in the editor. One lane, one behavior —
  // the shell owns it because the shell owns the master-detail selection. The
  // route's onPickSource still fires first (analytics / mode switching).
  const seedManualRow = useCallback(() => {
    const card = blankCard("sell");
    dispatch({ type: "ADD_CARDS", cards: [card] });
    startEditing(card.id);
  }, [dispatch, startEditing]);

  const handlePickSource = useCallback(
    (source: SetupSource) => {
      onPickSource?.(source);
      if (source === "manual") seedManualRow();
    },
    [onPickSource, seedManualRow],
  );

  // The upload lane's can't-read escape lands in the same seeded editor.
  const handleUploadAddManually = useCallback(() => {
    onUploadAddManually?.();
    seedManualRow();
  }, [onUploadAddManually, seedManualRow]);

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
  // A rejected card leaves the canvas, so editing it is over — the editor closes
  // rather than orbiting a row that no longer exists on the right.
  const editingCard = useMemo(
    () =>
      editingId
        ? cards.find((c) => c.id === editingId && c.state !== "rejected") ?? null
        : null,
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
      {/* ── HEADER STRIP — two compact rows; every pixel here costs the panes ── */}
      <header
        data-testid="wizard-header"
        className="flex shrink-0 flex-col gap-1.5 border-b border-glass-border px-3 pb-1.5 pt-2"
      >
        {/* Row 1 — section-tier title + inline bracket subtitle (drops <md) */}
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="shrink-0 font-cakemono text-cake-section font-light uppercase leading-none text-text">
            <span aria-hidden className="mr-1 font-mono text-data-sm text-text-mute">
              {"//"}
            </span>
            {t("title", "// your operating system").replace(/^\/\/\s*/, "")}
          </h1>
          <p className="hidden min-w-0 truncate font-mono text-micro tracking-wide text-text-3 md:block">
            {t(
              "subtitle",
              "[everything you sell, stock, and schedule — built once, used everywhere]",
            )}
          </p>
        </div>

        {/* Row 2 — rail (left) + actions (right) share the line. The rail keeps
            its min-content width so a too-narrow window wraps the actions to a
            second line instead of clipping segments. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <ModuleRail
            currentStep={currentStep}
            context={railContext}
            counts={counts}
            className="flex-1"
          />

          {/* Actions — ghost exit · caption/reason · the single primary CTA */}
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              data-testid="wizard-setup-later"
              onClick={onSetupLater}
              className="whitespace-nowrap font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
            >
              {t("build.later", "[ set up later ]")}
            </button>

            {/* Caption / precise blocker reason — single line beside the CTA
                (full text via title when truncated). Reason is mono `//` voice
                (a system readout); the ready caption is bracket micro-text. */}
            {disabledReason ? (
              <span
                id="wizard-build-reason"
                data-testid="wizard-build-reason"
                role="status"
                title={disabledReason}
                className={cn(
                  "max-w-[26ch] truncate whitespace-nowrap font-mono text-micro tracking-wide",
                  reason ? "text-tan" : "text-text-3",
                )}
                style={reason ? MONO_NUM : undefined}
              >
                {disabledReason}
              </span>
            ) : (
              <span
                data-testid="wizard-build-caption"
                title={t(
                  "build.caption",
                  "[adds {count} to your catalog — nothing goes live until you build]",
                ).replace("{count}", String(totals.added))}
                className="max-w-[26ch] truncate whitespace-nowrap font-mono text-micro tracking-wide text-text-3"
                style={MONO_NUM}
              >
                {t(
                  "build.caption",
                  "[adds {count} to your catalog — nothing goes live until you build]",
                ).replace("{count}", String(totals.added))}
              </span>
            )}

            {/* The ONE ops-accent element on the screen. Outlined at rest →
                fills bg-ops-accent text-black on hover. Standard 36px button
                tier (DESIGN.md §9). Disabled carries the precise reason via
                title + aria-describedby. */}
            <button
              type="button"
              data-testid="wizard-build-it"
              onClick={onBuild}
              disabled={!canBuild}
              aria-describedby={disabledReason ? "wizard-build-reason" : undefined}
              title={disabledReason ?? undefined}
              className={cn(
                "flex h-9 shrink-0 items-center rounded border px-2 font-cakemono text-cake-button font-light uppercase tracking-wide transition-colors duration-150",
                canBuild
                  ? "border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  : "cursor-not-allowed border-glass-border text-text-mute",
              )}
            >
              {t("build.cta", "BUILD IT")}
            </button>
          </div>
        </div>
      </header>

      {/* ── BODY — left pane (driver | editor) + right pane (canvas) ──────────
          ≥md: the two-column deck — panes hard-bounded, internal scroll only.
          <md: a stacked document column that page-scrolls; `shrink-0` children
          keep their natural height (nothing compresses toward 0px, nothing
          paints over a sibling; flex props are inert once the grid kicks in). */}
      <div
        data-testid="wizard-body"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2 md:grid md:grid-cols-[minmax(300px,360px)_1fr] lg:grid-cols-[minmax(340px,400px)_1fr]"
      >
        {/* LEFT — master-detail. DriverPane by default; ItemEditor when a card
            is selected for edit. A SINGLE keyed mount swaps the pane: the old
            pane unmounts with the state change, the new one fades in (each pane
            owns its entry + reduced-motion fallback). No AnimatePresence — an
            exit-gated swap can wedge the column behind an unfinished exit. */}
        <div
          data-testid="wizard-left-pane"
          className="flex shrink-0 flex-col md:min-h-0"
        >
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
              onAddManually={handleUploadAddManually}
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
              onPickSource={handlePickSource}
              onPickTrade={onPickTrade}
              availableSources={availableSources}
              onSwitchToGuided={onSwitchToGuided}
              onSend={onSend}
              busy={agentBusy}
              turns={conversationTurns}
              className="min-h-0 flex-1"
            />
          )}
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
          className="shrink-0 md:min-h-0"
        />
      </div>
    </div>
  );
}

export default SetupWizardShell;
