"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { CalendarClock, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { EntityPicker } from "@/components/ui/entity-picker";
import type { Opportunity } from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";
import {
  formatCurrency,
  getDaysInStage,
  isTerminalStage,
} from "@/lib/types/pipeline";
import {
  daysOverdue,
  formatShortDay,
  formatTimeAgo,
  isDateOverdue,
  isDateToday,
} from "@/lib/utils/date";
import {
  AddressAutocomplete,
  type AddressSelection,
} from "@/components/ops/projects/workspace/inputs/address-autocomplete";
import { PipelineCardActions } from "./pipeline-card-actions";

type PipelineCardDensity = "compact" | "comfortable";

export type PipelineCardActionHandlers = {
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onDiscard: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
  onOpenDetail: () => void;
  /** Convert an already-won, unconverted deal — opens the Won dialog directly. */
  onConvert?: () => void;
};

export type PipelineCardEditHandlers = {
  onTitleSave: (
    opportunity: Opportunity,
    title: string
  ) => void | Promise<void>;
  onLinkClient: (
    opportunity: Opportunity,
    clientId: string
  ) => void | Promise<void>;
  onCreateAndLinkClient: (
    opportunity: Opportunity,
    clientName: string
  ) => void | Promise<void>;
  onAddressSave: (
    opportunity: Opportunity,
    selection: AddressSelection
  ) => void | Promise<void>;
  /** Inline estimated-value edit on the card (null clears the value). */
  onValueSave: (
    opportunity: Opportunity,
    value: number | null
  ) => void | Promise<void>;
};

export interface PipelineCardContentProps
  extends
    Partial<PipelineCardActionHandlers>,
    Partial<PipelineCardEditHandlers> {
  opportunity: Opportunity;
  clientName: string;
  clients?: Client[];
  stageColor: string;
  stalenessOpacity: number;
  density: PipelineCardDensity;
  surfaceVariant?: "default" | "focused";
  canManage?: boolean;
  canAssign?: boolean;
  canConvert?: boolean;
  isSelected?: boolean;
  isHovered?: boolean;
  isExpanded?: boolean;
  openDetailLabel?: string;
  leadingAccessory?: React.ReactNode;
  quickStageActions?: React.ReactNode;
  /**
   * Optional ownership marker rendered in the top row beside the day count
   * (focused surface only). A ReactNode so the caller owns its presentation;
   * absent for scoped viewers and unassigned leads — it never adds a row.
   */
  assigneeMarker?: React.ReactNode;
  children?: React.ReactNode;
}

const noop = () => {};

function withHexAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${hex}${value.toString(16).padStart(2, "0").toUpperCase()}`;
}

export const PipelineCardContent = memo(function PipelineCardContent({
  opportunity,
  clientName,
  clients = [],
  stageColor,
  stalenessOpacity,
  density,
  surfaceVariant = "default",
  canManage = false,
  canAssign = canManage,
  canConvert = canManage,
  isSelected = false,
  isHovered = false,
  isExpanded = false,
  openDetailLabel,
  leadingAccessory,
  quickStageActions,
  assigneeMarker,
  onLogCall = noop,
  onLogText = noop,
  onAddNote = noop,
  onArchive = noop,
  onDiscard = noop,
  onMarkWon = noop,
  onMarkLost = noop,
  onAssign = noop,
  onScheduleFollowUp = noop,
  onOpenDetail = noop,
  onConvert,
  onTitleSave,
  onLinkClient,
  onCreateAndLinkClient,
  onAddressSave,
  onValueSave,
  children,
}: PipelineCardContentProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();

  if (density === "compact") {
    const cardEdgeBorder = isSelected
      ? `2px solid ${stageColor}`
      : isHovered || isExpanded
        ? `1px solid ${stageColor}50`
        : "1px solid var(--glass-border)";

    return (
      <div
        className={cn(
          "w-full rounded-chip",
          !reduced && "transition-[border-color,box-shadow] duration-150"
        )}
        style={{
          background: "var(--surface-glass)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          borderTop: cardEdgeBorder,
          borderRight: cardEdgeBorder,
          borderBottom: cardEdgeBorder,
          borderLeft: `3px solid ${stageColor}`,
          padding: "8px 10px",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mohave text-body-sm font-medium text-text">
            {clientName}
          </span>
          <span className="whitespace-nowrap font-mono text-data-sm tabular-nums text-text-2">
            {opportunity.estimatedValue != null
              ? formatCurrency(opportunity.estimatedValue)
              : "—"}
          </span>
        </div>

        {children}
      </div>
    );
  }

  const displayTitle = opportunity.title || clientName;
  const daysInStage = getDaysInStage(opportunity);
  const activeSurface = isHovered || isExpanded;
  const clampedStaleness = Math.max(0, Math.min(1, stalenessOpacity));
  const staleSurfaceOpacity = activeSurface ? 0 : (1 - clampedStaleness) * 0.28;
  const isFocusedSurface = surfaceVariant === "focused";
  const stageBorderColor = activeSurface
    ? stageColor
    : withHexAlpha(stageColor, 0.45 + clampedStaleness * 0.55);
  const focusedStageWash = activeSurface
    ? withHexAlpha(stageColor, 0.1)
    : withHexAlpha(stageColor, 0.055);
  const lastCorrespondence = [
    opportunity.lastInboundAt,
    opportunity.lastOutboundAt,
  ]
    .filter(Boolean)
    .sort((a, b) => b!.getTime() - a!.getTime())[0];

  // ── Dense signal line ──────────────────────────────────────────────────
  // Only signals that exist render — a card with no email history and no
  // scheduled follow-up shows no signal line at all (no empty placeholders).
  const hasEmailSignal = opportunity.correspondenceCount > 0;
  const followUpDate = opportunity.nextFollowUpAt;
  const hasFollowUpSignal = Boolean(followUpDate);
  const hasSignals = hasEmailSignal || hasFollowUpSignal;
  const followUpOverdue = isDateOverdue(followUpDate);
  const followUpToday = isDateToday(followUpDate);
  // Follow-up tone mirrors the board card: overdue = rose, due today = tan,
  // future = quiet. Its label reuses the existing dictionary strings.
  const followUpTone = followUpOverdue
    ? "text-financial-overdue"
    : followUpToday
      ? "text-tan"
      : "text-text-3";
  const followUpText = !followUpDate
    ? ""
    : followUpOverdue
      ? applyTemplate(t("card.overdue", "Overdue {count}d"), {
          count: String(daysOverdue(followUpDate)),
        })
      : followUpToday
        ? t("card.today", "Today")
        : applyTemplate(t("card.followUpDate", "Follow up {date}"), {
            date: formatShortDay(followUpDate),
          });
  // Days-in-stage attention tone: stale active deals (past ~70% of the
  // staleness ramp) count in tan; terminal/settled deals stay quiet.
  const staleCount =
    !isTerminalStage(opportunity.stage) && clampedStaleness <= 0.7;

  return (
    <div
      data-opportunity-card-id={isFocusedSurface ? opportunity.id : undefined}
      data-pipeline-card-shell={isFocusedSurface ? "focused" : undefined}
      tabIndex={isFocusedSurface ? -1 : undefined}
      className={cn(
        "glass-surface group/card relative w-full overflow-hidden rounded-panel [&::before]:rounded-panel",
        !reduced && "transition-[border-color] duration-150"
      )}
      style={{
        background: isFocusedSurface
          ? `linear-gradient(180deg, ${focusedStageWash} 0%, var(--surface-glass) 34%, var(--surface-glass) 100%)`
          : undefined,
        borderLeft: isFocusedSurface
          ? undefined
          : `4px solid ${stageBorderColor}`,
        borderColor: isFocusedSurface
          ? activeSurface
            ? "var(--glass-border-active)"
            : "var(--glass-border)"
          : undefined,
      }}
    >
      {isFocusedSurface ? (
        <span
          aria-hidden="true"
          data-pipeline-card-stage-accent=""
          className="pointer-events-none absolute left-2 right-2 top-0 z-[1] h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${withHexAlpha(stageColor, activeSurface ? 0.8 : 0.48)} 16%, ${withHexAlpha(stageColor, activeSurface ? 0.42 : 0.18)} 52%, transparent 100%)`,
          }}
        />
      ) : null}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-background",
          !reduced && "transition-opacity duration-150"
        )}
        style={{ opacity: staleSurfaceOpacity }}
      />

      <div className="relative z-[1] flex min-w-0">
        {leadingAccessory ? (
          <div className="flex w-5 shrink-0 items-stretch justify-center">
            {leadingAccessory}
          </div>
        ) : null}

        <div
          className={cn(
            "relative flex min-w-0 flex-1 flex-col gap-1 p-2",
            isFocusedSurface && "px-2.5 py-2",
            leadingAccessory ? "pl-1" : "pl-3",
            isFocusedSurface && leadingAccessory && "pl-1.5"
          )}
        >
          <div
            className="block w-full rounded-sm text-left"
            aria-label={openDetailLabel ?? t("card.viewDetails")}
          >
            {/* Row 1 — title + days-in-stage. The column IS the stage, so only
                the day count survives; stale active deals count in tan. */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <InlineTitleEditor
                  opportunity={opportunity}
                  displayTitle={displayTitle}
                  canManage={canManage}
                  onTitleSave={onTitleSave}
                />
              </div>
              {/* Top-row trailing cluster: ownership marker (focused surface,
                  company-wide viewers) + day count. The marker shares this row
                  so it never adds a line at comfortable density. */}
              <div className="flex shrink-0 items-center gap-1.5 pt-[3px]">
                {assigneeMarker}
                <span
                  title={applyTemplate(
                    t("card.daysInStage", "{count}d in stage"),
                    { count: String(daysInStage) }
                  )}
                  className={cn(
                    "font-mono text-micro tabular-nums [font-feature-settings:'tnum'_1,'zero'_1]",
                    staleCount ? "text-tan" : "text-text-3"
                  )}
                >
                  {daysInStage}D
                </span>
              </div>
            </div>

            {/* Row 2 — client · address merged on one truncating line, value
                right-aligned. Editors stay live as inline spans; an active
                address editor wraps to its own full-width line. */}
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
              <ClientLinkControl
                opportunity={opportunity}
                clientName={clientName}
                clients={clients}
                canManage={canManage}
                onLinkClient={onLinkClient}
                onCreateAndLinkClient={onCreateAndLinkClient}
              />
              {(opportunity.address || (canManage && onAddressSave)) && (
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-micro text-text-mute"
                >
                  ·
                </span>
              )}
              <InlineAddressEditor
                opportunity={opportunity}
                canManage={canManage}
                onAddressSave={onAddressSave}
              />
              <div className="ml-auto shrink-0">
                <InlineValueEditor
                  opportunity={opportunity}
                  canManage={canManage}
                  onValueSave={onValueSave}
                />
              </div>
            </div>
          </div>

          {/* Bottom slot — signal line at rest, actions on hover/focus-within.
              Both live in one fixed-height slot so the reveal never shifts
              layout. Reduced motion: both render in flow, always visible. */}
          {reduced ? (
            <>
              <SignalLine
                hasEmailSignal={hasEmailSignal}
                hasFollowUpSignal={hasFollowUpSignal}
                emailCount={opportunity.correspondenceCount}
                lastCorrespondence={lastCorrespondence ?? null}
                followUpText={followUpText}
                followUpTone={followUpTone}
                emailTitle={applyTemplate(
                  t("card.emailCount", "{count} emails"),
                  { count: String(opportunity.correspondenceCount) }
                )}
              />
              <PipelineCardActions
                opportunityId={opportunity.id}
                stage={opportunity.stage}
                canManage={canManage}
                canAssign={canAssign}
                canConvert={canConvert}
                stageActions={quickStageActions}
                onLogCall={onLogCall}
                onLogText={onLogText}
                onAddNote={onAddNote}
                onArchive={onArchive}
                onMarkWon={onMarkWon}
                onMarkLost={onMarkLost}
                onDiscard={onDiscard}
                onAssign={onAssign}
                onScheduleFollowUp={onScheduleFollowUp}
                onOpenDetail={onOpenDetail}
                onConvert={onConvert}
              />
            </>
          ) : (
            <div className="relative min-h-[28px]">
              {hasSignals && (
                <div className="pointer-events-none absolute inset-0 flex items-center transition-opacity duration-150 ease-smooth group-focus-within/card:opacity-0 group-hover/card:opacity-0">
                  <SignalLine
                    hasEmailSignal={hasEmailSignal}
                    hasFollowUpSignal={hasFollowUpSignal}
                    emailCount={opportunity.correspondenceCount}
                    lastCorrespondence={lastCorrespondence ?? null}
                    followUpText={followUpText}
                    followUpTone={followUpTone}
                    emailTitle={applyTemplate(
                      t("card.emailCount", "{count} emails"),
                      { count: String(opportunity.correspondenceCount) }
                    )}
                  />
                </div>
              )}
              <div className="opacity-0 transition-opacity duration-150 ease-smooth group-focus-within/card:opacity-100 group-hover/card:opacity-100">
                <PipelineCardActions
                  opportunityId={opportunity.id}
                  stage={opportunity.stage}
                  canManage={canManage}
                  canAssign={canAssign}
                  canConvert={canConvert}
                  stageActions={quickStageActions}
                  onLogCall={onLogCall}
                  onLogText={onLogText}
                  onAddNote={onAddNote}
                  onArchive={onArchive}
                  onMarkWon={onMarkWon}
                  onMarkLost={onMarkLost}
                  onDiscard={onDiscard}
                  onAssign={onAssign}
                  onScheduleFollowUp={onScheduleFollowUp}
                  onOpenDetail={onOpenDetail}
                  onConvert={onConvert}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function applyTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template
  );
}

function InlineTitleEditor({
  opportunity,
  displayTitle,
  canManage,
  onTitleSave,
}: {
  opportunity: Opportunity;
  displayTitle: string;
  canManage: boolean;
  onTitleSave?: PipelineCardEditHandlers["onTitleSave"];
}) {
  const { t } = useDictionary("pipeline");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(displayTitle);
  }, [displayTitle, editing]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const titleLabel = applyTemplate(
    t("card.titleEditLabel", "Edit deal title: {title}"),
    { title: displayTitle }
  );
  const inputLabel = t("card.titleInputLabel", "Deal title");

  const commit = () => {
    const nextTitle = draft.trim();
    setEditing(false);

    if (!nextTitle) {
      setDraft(displayTitle);
      return;
    }

    if (nextTitle !== displayTitle) {
      void onTitleSave?.(opportunity, nextTitle);
    }
  };

  const cancel = () => {
    cancelBlurRef.current = true;
    setDraft(displayTitle);
    setEditing(false);
  };

  if (editing && canManage && onTitleSave) {
    return (
      <input
        ref={inputRef}
        type="text"
        aria-label={inputLabel}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          if (cancelBlurRef.current) {
            cancelBlurRef.current = false;
            return;
          }
          commit();
        }}
        className="block w-full min-w-0 cursor-text border-0 border-b border-line bg-transparent px-0 py-[1px] font-cakemono text-cake-button font-light uppercase text-text caret-text outline-none transition-colors duration-150 focus:border-line-hi focus:ring-0 focus-visible:outline-none"
        style={{ outline: "none", outlineOffset: 0 }}
      />
    );
  }

  if (!canManage || !onTitleSave) {
    return (
      <p className="truncate font-cakemono text-cake-button font-light uppercase text-text">
        {displayTitle}
      </p>
    );
  }

  return (
    <button
      type="button"
      aria-label={titleLabel}
      className="block w-full min-w-0 cursor-text truncate border-b border-transparent bg-transparent px-0 py-[1px] text-left font-cakemono text-cake-button font-light uppercase text-text transition-[border-color,color] duration-150 hover:border-line focus:border-line-hi focus-visible:border-line-hi focus-visible:outline-none"
      onFocus={() => setEditing(true)}
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{ outline: "none", outlineOffset: 0 }}
    >
      {displayTitle}
    </button>
  );
}

/**
 * InlineValueEditor — the card's estimated-value slot, editable in place on
 * the same grammar as {@link InlineTitleEditor}: the mono figure is a quiet
 * click-target (hover reveals an underline); click swaps in a bare bottom-lined
 * input; Enter/blur commits, Esc restores. Numbers stay JetBrains Mono with
 * tabular-lining + slashed zero, right-aligned so the figure never shifts
 * against the card edge. Commits parse loosely ("$12,480" → 12480); an empty
 * draft clears the value (null — the em-dash state, distinct from $0). All
 * pointer events stop propagation so editing never starts a card drag.
 */
function InlineValueEditor({
  opportunity,
  canManage,
  onValueSave,
}: {
  opportunity: Opportunity;
  canManage: boolean;
  onValueSave?: PipelineCardEditHandlers["onValueSave"];
}) {
  const { t } = useDictionary("pipeline");
  const value = opportunity.estimatedValue ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value));
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const display = value == null ? "—" : formatCurrency(value);
  const editLabel = applyTemplate(
    t("card.valueEditLabel", "Edit deal value: {value}"),
    { value: display }
  );
  const inputLabel = t("card.valueInputLabel", "Deal value");

  const numClass =
    "font-mono text-data-sm tabular-nums [font-feature-settings:'tnum'_1,'zero'_1]";

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (value != null) void onValueSave?.(opportunity, null);
      return;
    }
    const parsed = Number.parseFloat(trimmed.replace(/[^0-9.-]/g, ""));
    if (Number.isNaN(parsed)) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    if (parsed !== value) void onValueSave?.(opportunity, parsed);
  };

  const cancel = () => {
    cancelBlurRef.current = true;
    setDraft(value == null ? "" : String(value));
    setEditing(false);
  };

  if (editing && canManage && onValueSave) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label={inputLabel}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          if (cancelBlurRef.current) {
            cancelBlurRef.current = false;
            return;
          }
          commit();
        }}
        className={cn(
          "w-[96px] shrink-0 cursor-text border-0 border-b border-line bg-transparent px-0 py-[1px]",
          "text-right text-text caret-text outline-none",
          "transition-colors duration-150 focus:border-line-hi focus:ring-0 focus-visible:outline-none",
          numClass
        )}
        style={{ outline: "none", outlineOffset: 0 }}
      />
    );
  }

  if (!canManage || !onValueSave) {
    return (
      <span className={cn("shrink-0 text-text", numClass)}>{display}</span>
    );
  }

  return (
    <button
      type="button"
      aria-label={editLabel}
      className={cn(
        "shrink-0 cursor-text border-b border-transparent bg-transparent px-0 py-[1px] text-right text-text",
        "transition-[border-color] duration-150 hover:border-line focus-visible:border-line-hi focus-visible:outline-none",
        numClass
      )}
      onFocus={() => setEditing(true)}
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{ outline: "none", outlineOffset: 0 }}
    >
      {display}
    </button>
  );
}

/**
 * ClientLinkControl — the card's client line, on the canonical
 * {@link EntityPicker} (previously the last bespoke client picker: a manually
 * anchored portal with its own collision math and keyboard cursor). Radix owns
 * anchoring/collision, cmdk owns keyboard nav. The current client renders as
 * the panel's selected row; the query-seeded footer preserves the
 * create-and-link affordance (`Create client <typed name>`). Creating a name
 * that exactly matches an existing client links that client instead — the same
 * duplicate guard the old control expressed by hiding its create row. The
 * trigger keeps the card's stopPropagation guards so opening the picker never
 * starts a card drag or click-through.
 */
function ClientLinkControl({
  opportunity,
  clientName,
  clients,
  canManage,
  onLinkClient,
  onCreateAndLinkClient,
}: {
  opportunity: Opportunity;
  clientName: string;
  clients: Client[];
  canManage: boolean;
  onLinkClient?: PipelineCardEditHandlers["onLinkClient"];
  onCreateAndLinkClient?: PipelineCardEditHandlers["onCreateAndLinkClient"];
}) {
  const { t } = useDictionary("pipeline");
  const { t: tp } = useDictionary("picker");
  const [open, setOpen] = useState(false);
  const canEdit = canManage && Boolean(onLinkClient || onCreateAndLinkClient);
  const hasLinkedClient = Boolean(opportunity.clientId);
  const currentClient = hasLinkedClient
    ? (clients.find((client) => client.id === opportunity.clientId) ?? null)
    : null;
  const emptyClientName = t("card.clientEmpty", "NO CLIENT");
  const currentClientName = hasLinkedClient
    ? (currentClient?.name ?? clientName).trim()
    : "";
  const displayClientName = currentClientName || emptyClientName;
  const label = applyTemplate(
    t("card.clientLinkLabel", "Link client: {client}"),
    { client: displayClientName }
  );
  const createLabel = t("card.clientCreate", "Create client");
  const createNewLabel = t("card.clientCreateNew", "Create new client");

  const items = useMemo(
    () => clients.filter((client) => !client.deletedAt),
    [clients]
  );

  const handleChange = (id: string | null) => {
    if (!id || id === opportunity.clientId) return;
    void onLinkClient?.(opportunity, id);
  };

  const handleCreate = (query: string) => {
    const name = query.trim();
    if (!name) return; // stay open — the operator hasn't typed a name yet
    const exact = items.find(
      (client) => client.name.trim().toLowerCase() === name.toLowerCase()
    );
    setOpen(false);
    if (exact) {
      handleChange(exact.id);
      return;
    }
    void onCreateAndLinkClient?.(opportunity, name);
  };

  if (!canEdit) {
    return (
      <p className="min-w-0 shrink truncate font-mono text-micro text-text-3">
        {displayClientName}
      </p>
    );
  }

  return (
    <div className="relative min-w-0 shrink">
      <EntityPicker<Client>
        trigger={
          <button
            type="button"
            aria-label={label}
            className="block max-w-full truncate rounded text-left font-mono text-micro text-text-3 transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {displayClientName}
          </button>
        }
        open={open}
        onOpenChange={setOpen}
        label={t("card.clientSearchLabel", "Search clients")}
        items={items}
        value={opportunity.clientId ?? null}
        onChange={handleChange}
        getId={(client) => client.id}
        getLabel={(client) => client.name}
        getDescription={(client) => client.email ?? undefined}
        getKeywords={(client) =>
          [client.email, client.phoneNumber, client.address].filter(
            (term): term is string => Boolean(term)
          )
        }
        searchPlaceholder={t(
          "card.clientSearchPlaceholder",
          "Search clients..."
        )}
        clearLabel={tp("clear")}
        emptyLabel={t("card.clientNoMatches", "No client match")}
        createAction={
          onCreateAndLinkClient
            ? {
                label: (query) => {
                  const name = query.trim();
                  return name ? `${createLabel} ${name}` : createNewLabel;
                },
                onCreate: handleCreate,
              }
            : undefined
        }
      />
    </div>
  );
}

function InlineAddressEditor({
  opportunity,
  canManage,
  onAddressSave,
}: {
  opportunity: Opportunity;
  canManage: boolean;
  onAddressSave?: PipelineCardEditHandlers["onAddressSave"];
}) {
  const { t } = useDictionary("pipeline");
  const addressInputId = useId();
  const [editing, setEditing] = useState(false);
  const canEdit = canManage && onAddressSave;
  const currentAddress = opportunity.address ?? "";

  if (!currentAddress && !canEdit) return null;

  if (editing && canEdit) {
    return (
      <div
        data-keyboard-scope="modal-or-menu"
        className="w-full"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setEditing(false);
          }
        }}
      >
        <AddressAutocomplete
          id={addressInputId}
          value={currentAddress}
          ariaLabel={t("card.addressLabel", "Edit site address")}
          placeholder={t("card.addressPlaceholder", "Site address")}
          variant="inline"
          portalListbox
          proximity={
            opportunity.latitude != null && opportunity.longitude != null
              ? {
                  latitude: opportunity.latitude,
                  longitude: opportunity.longitude,
                }
              : undefined
          }
          onChange={(selection) => {
            void onAddressSave?.(opportunity, selection);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  const addressLabel = t("card.addressLabel", "Edit site address");
  const addressText = currentAddress || t("card.addressEmpty", "NO ADDRESS");

  if (!canEdit) {
    return (
      <p className="min-w-0 flex-1 truncate font-mono text-micro text-text-3">
        {addressText}
      </p>
    );
  }

  return (
    <button
      type="button"
      aria-label={addressLabel}
      className="min-w-0 flex-1 truncate rounded text-left font-mono text-micro text-text-3 transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {addressText}
    </button>
  );
}

/**
 * SignalLine — the card's one-line email + follow-up readout. Only signals
 * that exist render (a card with no email history and no follow-up shows
 * nothing — no empty placeholders). Icons are 12px metadata glyphs; counts
 * and dates stay mono micro with tabular-lining figures.
 */
function SignalLine({
  hasEmailSignal,
  hasFollowUpSignal,
  emailCount,
  lastCorrespondence,
  followUpText,
  followUpTone,
  emailTitle,
}: {
  hasEmailSignal: boolean;
  hasFollowUpSignal: boolean;
  emailCount: number;
  lastCorrespondence: Date | null;
  followUpText: string;
  followUpTone: string;
  emailTitle: string;
}) {
  if (!hasEmailSignal && !hasFollowUpSignal) return null;

  return (
    <div className="flex min-w-0 items-center gap-1 font-mono text-micro text-text-3 [font-feature-settings:'tnum'_1,'zero'_1]">
      {hasEmailSignal && (
        <span
          className="inline-flex min-w-0 items-center gap-1"
          title={emailTitle}
        >
          <Mail
            aria-hidden="true"
            className="h-3 w-3 shrink-0"
            strokeWidth={1.5}
          />
          <span className="tabular-nums">{emailCount}</span>
          {lastCorrespondence && (
            <>
              <span aria-hidden="true" className="text-text-mute">
                ·
              </span>
              <span className="truncate">
                {formatTimeAgo(lastCorrespondence)}
              </span>
            </>
          )}
        </span>
      )}
      {hasEmailSignal && hasFollowUpSignal && (
        <span aria-hidden="true" className="shrink-0 text-text-mute">
          ·
        </span>
      )}
      {hasFollowUpSignal && (
        <span
          className={cn("inline-flex min-w-0 items-center gap-1", followUpTone)}
        >
          <CalendarClock
            aria-hidden="true"
            className="h-3 w-3 shrink-0"
            strokeWidth={1.5}
          />
          <span className="truncate">{followUpText}</span>
        </span>
      )}
    </div>
  );
}
