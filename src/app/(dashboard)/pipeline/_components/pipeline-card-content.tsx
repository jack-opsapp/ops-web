"use client";

import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { EntityPicker } from "@/components/ui/entity-picker";
import type { Opportunity } from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";
import {
  formatCurrency,
  getDaysInStage,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import { formatTimeAgo } from "@/lib/utils/date";
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
  onTitleSave: (opportunity: Opportunity, title: string) => void | Promise<void>;
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
};

export interface PipelineCardContentProps
  extends Partial<PipelineCardActionHandlers>,
    Partial<PipelineCardEditHandlers> {
  opportunity: Opportunity;
  clientName: string;
  clients?: Client[];
  stageColor: string;
  stalenessOpacity: number;
  density: PipelineCardDensity;
  surfaceVariant?: "default" | "focused";
  canManage?: boolean;
  isSelected?: boolean;
  isHovered?: boolean;
  isExpanded?: boolean;
  openDetailLabel?: string;
  leadingAccessory?: React.ReactNode;
  quickStageActions?: React.ReactNode;
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
  isSelected = false,
  isHovered = false,
  isExpanded = false,
  openDetailLabel,
  leadingAccessory,
  quickStageActions,
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
          <span className="font-mohave text-body-sm font-medium text-text truncate">
            {clientName}
          </span>
          <span className="font-mono text-data-sm text-text-2 tabular-nums whitespace-nowrap">
            {opportunity.estimatedValue
              ? formatCurrency(opportunity.estimatedValue)
              : "—"}
          </span>
        </div>

        {children}
      </div>
    );
  }

  const displayTitle = opportunity.title || clientName;
  const stageName = getStageDisplayName(opportunity.stage);
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

  return (
    <div
      data-opportunity-card-id={isFocusedSurface ? opportunity.id : undefined}
      data-pipeline-card-shell={isFocusedSurface ? "focused" : undefined}
      tabIndex={isFocusedSurface ? -1 : undefined}
      className={cn(
        "glass-surface relative w-full overflow-hidden rounded-panel [&::before]:rounded-panel",
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
          <div className="flex w-12 shrink-0 items-center justify-center py-2 pl-1">
            {leadingAccessory}
          </div>
        ) : null}

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-1 p-2",
            isFocusedSurface && "gap-1.5 px-2.5 py-2.5",
            leadingAccessory ? "pl-1" : "pl-3",
            isFocusedSurface && leadingAccessory && "pl-1.5"
          )}
        >
          <div
            className="block w-full rounded-sm text-left"
            aria-label={openDetailLabel ?? t("card.viewDetails")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <InlineTitleEditor
                  opportunity={opportunity}
                  displayTitle={displayTitle}
                  canManage={canManage}
                  onTitleSave={onTitleSave}
                />
                <ClientLinkControl
                  opportunity={opportunity}
                  clientName={clientName}
                  clients={clients}
                  canManage={canManage}
                  onLinkClient={onLinkClient}
                  onCreateAndLinkClient={onCreateAndLinkClient}
                />
                <InlineAddressEditor
                  opportunity={opportunity}
                  canManage={canManage}
                  onAddressSave={onAddressSave}
                />
              </div>
              <span className="shrink-0 font-mono text-data-sm text-text">
                {opportunity.estimatedValue
                  ? formatCurrency(opportunity.estimatedValue)
                  : "—"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1 border-t border-line pt-1">
              <Metric label={stageName} value={`${daysInStage}d`} />
              <Metric
                label={t("card.emailCount", "{count} emails").replace(
                  "{count}",
                  String(opportunity.correspondenceCount)
                )}
                value={
                  lastCorrespondence
                    ? formatTimeAgo(lastCorrespondence)
                    : "—"
                }
              />
              <Metric
                label={t("card.followUpDate", "Follow up {date}").replace(
                  "{date}",
                  ""
                )}
                value={
                  opportunity.nextFollowUpAt
                    ? formatTimeAgo(opportunity.nextFollowUpAt)
                    : "—"
                }
              />
            </div>
          </div>

          <PipelineCardActions
            opportunityId={opportunity.id}
            stage={opportunity.stage}
            canManage={canManage}
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
      <p className="truncate font-mohave text-body-sm text-text-2">
        {displayClientName}
      </p>
    );
  }

  return (
    <div className="relative min-w-0">
      <EntityPicker<Client>
        trigger={
          <button
            type="button"
            aria-label={label}
            className="block w-full truncate rounded text-left font-mohave text-body-sm text-text-2 transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
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
        searchPlaceholder={t("card.clientSearchPlaceholder", "Search clients...")}
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
        className="mt-1"
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
      <p className="mt-1 truncate font-mohave text-body-sm text-text-3">
        {addressText}
      </p>
    );
  }

  return (
    <button
      type="button"
      aria-label={addressLabel}
      className="mt-1 block w-full truncate rounded text-left font-mohave text-body-sm text-text-3 transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        {label}
      </p>
      <p className="truncate font-mono text-data-sm text-text-2">{value}</p>
    </div>
  );
}
