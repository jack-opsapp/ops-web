"use client";

/**
 * OPS Web — Lead-detail inline field editors.
 *
 * Small, self-contained editors that back the map-backed summary band
 * (`LeadMapBand`) and the Overview tab (`PipelineDetailOverviewTab`). Each one
 * follows the same OPS entity-detail idiom: a glance-able read display that,
 * when the operator can manage the pipeline, becomes a click target opening a
 * compact editor. Because most of these float over a live Mapbox backdrop, the
 * popovers paint on the dense-glass surface + the sanctioned `--shadow-dropdown`
 * token (the one box-shadow exception over busy underlayments) and portal to
 * `document.body` so the window/drawer never clips them.
 *
 * ── Shared-edit contract ──────────────────────────────────────────────────
 * The PARENT owns a single {@link useOpportunityFieldEdit} instance and threads
 * it down as `edit`. Editors NEVER call the hook themselves — one optimistic
 * mutation engine per opportunity, many editors. Every editor guards its own
 * no-op commits (it knows its prior value) and surfaces the per-field
 * `saving → saved → idle` / `error` pulse via {@link SaveDot}.
 *
 * ── Design tokens (traced to .interface-design/system.md) ────────────────────
 *  - popovers: `glass-dense` + `var(--shadow-dropdown)` + `rounded-modal` (12px)
 *  - inputs: `var(--surface-input)` fill, `border-glass-border` → brightens on
 *    focus (NO accent on input borders); min-h 36 (web is non-touch), radius 5
 *  - numbers: `font-mono` with `"tnum" 1, "zero" 1`
 *  - accent (`ops-accent`): focus ring ONLY
 *  - priority chip: earth-tone border-only, ALWAYS with its text label
 *  - empty: the `—` sentinel, never "N/A"
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "framer-motion";
import { Check, Plus, X } from "lucide-react";

import { useDictionary } from "@/i18n/client";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { getUserFullName } from "@/lib/types/models";
import {
  OpportunityPriority,
  OpportunitySource,
  formatCurrency,
} from "@/lib/types/pipeline";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { UserAvatar } from "@/components/ops/user-avatar";
import { Chip, type ChipVariant } from "@/components/ops/projects/workspace/atoms/chip";
import { TextArea } from "@/components/ops/projects/workspace/atoms/text-area";
import { AddressAutocomplete } from "@/components/ops/projects/workspace/inputs/address-autocomplete";
import type {
  AddressEditValue,
  EditableOpportunityField,
  FieldSaveState,
  UseOpportunityFieldEdit,
} from "@/lib/hooks/use-opportunity-field-edit";

// ─── Shared types ─────────────────────────────────────────────────────────────

/** Em-dash sentinel for every empty field (never "N/A"). */
const EMPTY = "—";

interface BaseFieldProps {
  /** The shared optimistic edit instance, owned by the parent. */
  edit: UseOpportunityFieldEdit;
  /** Gates every edit affordance on `pipeline.manage`. */
  canManage: boolean;
  className?: string;
}

// ─── EditPopover ───────────────────────────────────────────────────────────────

/**
 * A floating, trigger-anchored editor surface. Portals to `document.body` so it
 * escapes the floating-window / drawer clip, paints dense-glass over the map,
 * and closes on outside `mousedown` + Esc. First focusable element is focused on
 * open; focus returns to the trigger on close. Re-anchors on scroll/resize like
 * {@link AddressAutocomplete}'s portal listbox.
 *
 * Exported so the band + Overview can build their own bespoke editors on the
 * same surface without re-deriving the anchoring/dismiss plumbing.
 */
export function EditPopover({
  open,
  onClose,
  anchorRef,
  children,
  ariaLabel,
  width = 240,
  align = "start",
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  ariaLabel: string;
  /** Fixed popover width in px (min content width). */
  width?: number;
  /** Horizontal edge to align to the trigger. */
  align?: "start" | "end";
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const gutter = 8;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const spaceBelow = viewportH - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, (openUp ? spaceAbove : spaceBelow) - 4);
    const top = openUp ? Math.max(gutter, rect.top - 4) : rect.bottom + 4;
    const rawLeft = align === "end" ? rect.right - width : rect.left;
    const left = Math.min(
      Math.max(gutter, rawLeft),
      Math.max(gutter, viewportW - width - gutter),
    );
    setPosition({
      // When opening upward the panel is bottom-anchored via translateY below.
      top: openUp ? rect.top - 4 : top,
      left,
      maxHeight,
    });
  }, [anchorRef, align, width]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  // Focus the first focusable element on open; restore focus to the trigger on
  // close so keyboard users land back where they were. The panel node is
  // captured at setup time (`panel`) — by cleanup the ref may already be
  // detached, so the captured reference is what we test against.
  useEffect(() => {
    if (!open) return;
    const trigger = anchorRef.current;
    const timeout = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);
    const panel = panelRef.current;
    return () => {
      window.clearTimeout(timeout);
      // Only restore if focus is still inside the closing panel (avoid stealing
      // focus when the operator clicked elsewhere entirely).
      if (
        document.activeElement &&
        panel?.contains(document.activeElement)
      ) {
        trigger?.focus();
      }
    };
  }, [open, anchorRef]);

  // Outside-click + Esc dismiss.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (anchorRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      className="glass-dense fixed z-[1000] overflow-y-auto scrollbar-hide rounded-modal border border-glass-border p-1.5"
      style={{
        top: position.top,
        left: position.left,
        width,
        maxHeight: position.maxHeight,
        boxShadow: "var(--shadow-dropdown)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ─── SaveDot ───────────────────────────────────────────────────────────────────

/**
 * The quiet save affordance for a single field. `saving` → a muted "saving…"
 * micro-label; `saved` → a brief olive dot; `error` → a rose dot. Opacity-only
 * so it satisfies `prefers-reduced-motion` without special-casing.
 */
function SaveDot({
  state,
  className,
}: {
  state: FieldSaveState;
  className?: string;
}) {
  const { t } = useDictionary("pipeline");
  const reduceMotion = useReducedMotion();
  if (state === "idle") return null;

  if (state === "saving") {
    return (
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute",
          className,
        )}
        aria-live="polite"
      >
        {t("band.saving", "saving…")}
      </span>
    );
  }

  const tone = state === "saved" ? "var(--olive)" : "var(--rose)";
  return (
    <span
      role="status"
      aria-label={
        state === "saved"
          ? t("band.saved", "Saved")
          : t("band.saveError", "Save failed")
      }
      className={cn("inline-block h-[5px] w-[5px] rounded-full", className)}
      style={{
        backgroundColor: tone,
        transition: reduceMotion ? "none" : "opacity 150ms cubic-bezier(0.22,1,0.36,1)",
      }}
    />
  );
}

// ─── Shared trigger ─────────────────────────────────────────────────────────────

/**
 * The standard inline edit trigger: a left-aligned button that reveals its
 * editor on click, brightens on hover, and shows the OPS focus ring. Used by
 * the popover-backed fields (currency / source / priority / date / owner).
 */
const triggerClass = cn(
  "group inline-flex max-w-full items-center gap-1.5 rounded-[5px] px-1 py-0.5 text-left",
  "outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
  "hover:bg-surface-hover focus-visible:bg-surface-hover",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
);

/** A read-only display value with the `—` sentinel for empty. */
function ReadOnlyValue({
  children,
  empty,
  className,
}: {
  children?: ReactNode;
  empty: boolean;
  className?: string;
}) {
  return (
    <span className={className}>
      {empty ? <span className="text-text-3">{EMPTY}</span> : children}
    </span>
  );
}

// ─── Option list (shared by source / priority / owner) ───────────────────────────

interface OptionRowProps {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** Marks the row that clears the field (Clear / Unassign). */
  clear?: boolean;
}

function OptionRow({ selected, onSelect, children, clear }: OptionRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-owner-clear={clear ? "true" : undefined}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-[5px] px-2 text-left",
        "font-mohave text-[14px] transition-colors duration-100",
        "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        selected ? "bg-surface-active text-text" : "text-text-2",
      )}
    >
      <span className="flex w-3.5 shrink-0 items-center justify-center">
        {selected ? <Check className="h-3.5 w-3.5 text-ops-accent" strokeWidth={1.5} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

// ─── CurrencyField ───────────────────────────────────────────────────────────────

export function CurrencyField({
  edit,
  canManage,
  value,
  className,
}: BaseFieldProps & { value: number | null }) {
  const { t } = useDictionary("pipeline");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const display = (
    <span className="font-mono tabular-nums [font-feature-settings:'tnum'_1,'zero'_1]">
      {value == null ? EMPTY : formatCurrency(value)}
    </span>
  );

  if (!canManage) {
    return (
      <ReadOnlyValue empty={value == null} className={cn("font-mono tabular-nums [font-feature-settings:'tnum'_1,'zero'_1]", className)}>
        {value == null ? null : formatCurrency(value)}
      </ReadOnlyValue>
    );
  }

  function openEditor() {
    setDraft(value == null ? "" : String(value));
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function commitDraft() {
    if (committingRef.current) return;
    const trimmed = draft.trim();
    const prior = value == null ? "" : String(value);
    if (trimmed === prior) {
      close();
      return;
    }
    committingRef.current = true;
    void edit.commit("estimatedValue", trimmed).finally(() => {
      committingRef.current = false;
    });
    close();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("band.estimatedValue", "Estimated value")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openEditor}
        className={triggerClass}
      >
        {display}
      </button>
      <SaveDot state={edit.saveState("estimatedValue")} />

      <EditPopover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        ariaLabel={t("band.estimatedValue", "Estimated value")}
        width={200}
      >
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          aria-label={t("band.estimatedValue", "Estimated value")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commitDraft}
          placeholder={t("band.valuePlaceholder", "0")}
          className={cn(
            "h-9 w-full rounded-[5px] border border-glass-border bg-[var(--surface-input)] px-2",
            "font-mono text-[14px] tabular-nums text-text [font-feature-settings:'tnum'_1,'zero'_1]",
            "outline-none transition-colors duration-150 placeholder:text-text-mute",
            "focus:border-glass-border-strong focus-visible:ring-1 focus-visible:ring-ops-accent",
          )}
        />
      </EditPopover>
    </span>
  );
}

// ─── Enum picker (source / priority) shared body ─────────────────────────────────

function useEnumPicker<T extends string>(
  field: EditableOpportunityField,
  edit: UseOpportunityFieldEdit,
) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const select = useCallback(
    (next: T | null) => {
      void edit.commit(field, next);
      setOpen(false);
    },
    [edit, field],
  );
  return { open, setOpen, triggerRef, select };
}

// ─── SourceField ─────────────────────────────────────────────────────────────────

const SOURCE_FALLBACK_LABELS: Record<OpportunitySource, string> = {
  [OpportunitySource.Referral]: "Referral",
  [OpportunitySource.Website]: "Website",
  [OpportunitySource.Email]: "Email",
  [OpportunitySource.Phone]: "Phone",
  [OpportunitySource.WalkIn]: "Walk in",
  [OpportunitySource.SocialMedia]: "Social media",
  [OpportunitySource.RepeatClient]: "Repeat client",
  [OpportunitySource.VoiceLog]: "Voice log",
  [OpportunitySource.Other]: "Other",
};

export function SourceField({
  edit,
  canManage,
  value,
  className,
}: BaseFieldProps & { value: OpportunitySource | null }) {
  const { t } = useDictionary("pipeline");
  const { open, setOpen, triggerRef, select } = useEnumPicker<OpportunitySource>(
    "source",
    edit,
  );

  const label = (src: OpportunitySource) =>
    t(`band.source.${src}`, SOURCE_FALLBACK_LABELS[src]);

  if (!canManage) {
    return (
      <ReadOnlyValue empty={value == null} className={cn("font-mohave text-[14px] text-text-2", className)}>
        {value == null ? null : label(value)}
      </ReadOnlyValue>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("band.sourceLabel", "Source")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        <span className="truncate font-mohave text-[14px] text-text-2 group-hover:text-text">
          {value == null ? EMPTY : label(value)}
        </span>
      </button>
      <SaveDot state={edit.saveState("source")} />

      <EditPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        ariaLabel={t("band.sourceLabel", "Source")}
        width={220}
      >
        <div role="listbox" aria-label={t("band.sourceLabel", "Source")}>
          {(Object.values(OpportunitySource) as OpportunitySource[]).map((src) => (
            <OptionRow
              key={src}
              selected={value === src}
              onSelect={() => select(src)}
            >
              {label(src)}
            </OptionRow>
          ))}
          <div className="my-1 h-px bg-glass-border" />
          <OptionRow selected={false} clear onSelect={() => select(null)}>
            <span className="text-text-3">{t("band.clear", "Clear")}</span>
          </OptionRow>
        </div>
      </EditPopover>
    </span>
  );
}

// ─── PriorityField ───────────────────────────────────────────────────────────────

const PRIORITY_FALLBACK_LABELS: Record<OpportunityPriority, string> = {
  [OpportunityPriority.High]: "High",
  [OpportunityPriority.Medium]: "Medium",
  [OpportunityPriority.Low]: "Low",
};

/** Priority → chip variant: high = rose, medium = tan, low = neutral. */
const PRIORITY_CHIP_VARIANT: Record<OpportunityPriority, ChipVariant> = {
  [OpportunityPriority.High]: "rose",
  [OpportunityPriority.Medium]: "tan",
  [OpportunityPriority.Low]: "neutral",
};

export function PriorityField({
  edit,
  canManage,
  value,
  className,
}: BaseFieldProps & { value: OpportunityPriority | null }) {
  const { t } = useDictionary("pipeline");
  const { open, setOpen, triggerRef, select } = useEnumPicker<OpportunityPriority>(
    "priority",
    edit,
  );

  const label = (p: OpportunityPriority) =>
    t(`band.priority.${p}`, PRIORITY_FALLBACK_LABELS[p]);

  const chip =
    value == null ? (
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
        {EMPTY}
      </span>
    ) : (
      <Chip variant={PRIORITY_CHIP_VARIANT[value]}>{label(value)}</Chip>
    );

  if (!canManage) {
    return <span className={cn("inline-flex items-center", className)}>{chip}</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("band.priorityLabel", "Priority")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(triggerClass, "px-0.5")}
      >
        {chip}
      </button>
      <SaveDot state={edit.saveState("priority")} />

      <EditPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        ariaLabel={t("band.priorityLabel", "Priority")}
        width={200}
      >
        <div role="listbox" aria-label={t("band.priorityLabel", "Priority")}>
          {(
            [
              OpportunityPriority.High,
              OpportunityPriority.Medium,
              OpportunityPriority.Low,
            ] as OpportunityPriority[]
          ).map((p) => (
            <OptionRow key={p} selected={value === p} onSelect={() => select(p)}>
              <Chip variant={PRIORITY_CHIP_VARIANT[p]}>{label(p)}</Chip>
            </OptionRow>
          ))}
          <div className="my-1 h-px bg-glass-border" />
          <OptionRow selected={false} clear onSelect={() => select(null)}>
            <span className="text-text-3">{t("band.clear", "Clear")}</span>
          </OptionRow>
        </div>
      </EditPopover>
    </span>
  );
}

// ─── DateField ───────────────────────────────────────────────────────────────────

/** A Date → `yyyy-MM-dd` string for `<input type="date">`, in local time. */
function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DateField({
  edit,
  canManage,
  value,
  className,
}: BaseFieldProps & { value: Date | null }) {
  const { t } = useDictionary("pipeline");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const display = value == null ? EMPTY : formatDate(value);

  if (!canManage) {
    return (
      <ReadOnlyValue empty={value == null} className={cn("font-mono text-[13px] tabular-nums text-text-2 [font-feature-settings:'tnum'_1,'zero'_1]", className)}>
        {value == null ? null : display}
      </ReadOnlyValue>
    );
  }

  function onPick(raw: string) {
    if (raw.length === 0) {
      void edit.commit("expectedCloseDate", null);
    } else {
      // Anchor to local noon so the ISO string lands on the chosen calendar day
      // regardless of timezone (avoids a UTC-midnight day rollback).
      const iso = new Date(`${raw}T12:00:00`).toISOString();
      void edit.commit("expectedCloseDate", iso);
    }
    setOpen(false);
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("band.closeDate", "Expected close")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        <span className="truncate font-mono text-[13px] tabular-nums text-text-2 group-hover:text-text [font-feature-settings:'tnum'_1,'zero'_1]">
          {display}
        </span>
      </button>
      <SaveDot state={edit.saveState("expectedCloseDate")} />

      <EditPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        ariaLabel={t("band.closeDate", "Expected close")}
        width={200}
      >
        <input
          type="date"
          aria-label={t("band.closeDate", "Expected close")}
          defaultValue={toDateInputValue(value)}
          onChange={(event) => onPick(event.target.value)}
          className={cn(
            "h-9 w-full rounded-[5px] border border-glass-border bg-[var(--surface-input)] px-2",
            "font-mono text-[13px] tabular-nums text-text [font-feature-settings:'tnum'_1,'zero'_1]",
            "outline-none transition-colors duration-150",
            "focus:border-glass-border-strong focus-visible:ring-1 focus-visible:ring-ops-accent",
            "[color-scheme:dark]",
          )}
        />
      </EditPopover>
    </span>
  );
}

// ─── OwnerField ──────────────────────────────────────────────────────────────────

export function OwnerField({
  edit,
  canManage,
  value,
  className,
}: BaseFieldProps & { value: string | null }) {
  const { t } = useDictionary("pipeline");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  // Load members lazily — only while the picker is open (cheap closed state).
  const teamQuery = useTeamMembers(undefined, {
    enabled: open || canManage,
    staleTime: 5 * 60 * 1000,
  });

  const members = useMemo(
    () =>
      (teamQuery.data?.users ?? [])
        .filter((user) => user.isActive !== false)
        .map((user) => ({
          id: user.id,
          name: getUserFullName(user),
          imageUrl: user.profileImageURL,
        })),
    [teamQuery.data?.users],
  );

  const current = members.find((m) => m.id === value) ?? null;
  const unassignedLabel = t("band.unassigned", "Unassigned");

  const display = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {current ? (
        <>
          <UserAvatar name={current.name} imageUrl={current.imageUrl} size="sm" />
          <span className="truncate font-mohave text-[14px] text-text-2">
            {current.name}
          </span>
        </>
      ) : (
        <span className="truncate font-mohave text-[14px] text-text-3">
          {value == null ? unassignedLabel : t("band.unknownOwner", "Unknown")}
        </span>
      )}
    </span>
  );

  if (!canManage) {
    return <span className={cn("inline-flex min-w-0 items-center", className)}>{display}</span>;
  }

  function select(userId: string | null) {
    void edit.commit("assignedTo", userId);
    setOpen(false);
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("band.ownerLabel", "Owner")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(triggerClass, "min-w-0")}
      >
        {display}
      </button>
      <SaveDot state={edit.saveState("assignedTo")} />

      <EditPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        ariaLabel={t("band.ownerLabel", "Owner")}
        width={240}
      >
        <div role="listbox" aria-label={t("band.ownerLabel", "Owner")}>
          <OptionRow selected={value == null} clear onSelect={() => select(null)}>
            <span className="text-text-3">{unassignedLabel}</span>
          </OptionRow>
          <div className="my-1 h-px bg-glass-border" />
          {members.map((member) => (
            <OptionRow
              key={member.id}
              selected={member.id === value}
              onSelect={() => select(member.id)}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <UserAvatar name={member.name} imageUrl={member.imageUrl} size="sm" />
                <span className="truncate">{member.name}</span>
              </span>
            </OptionRow>
          ))}
          {members.length === 0 ? (
            <p className="px-2 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
              {t("band.noTeam", "No team members")}
            </p>
          ) : null}
        </div>
      </EditPopover>
    </span>
  );
}

// ─── TagsField ───────────────────────────────────────────────────────────────────

export function TagsField({
  edit,
  canManage,
  value,
  className,
}: BaseFieldProps & { value: string[] }) {
  const { t } = useDictionary("pipeline");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const tags = value ?? [];

  if (!canManage) {
    return (
      <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
        {tags.length === 0 ? (
          <span className="text-text-3">{EMPTY}</span>
        ) : (
          tags.map((tag) => (
            <Chip key={tag} variant="neutral">
              {tag}
            </Chip>
          ))
        )}
      </span>
    );
  }

  function addTag() {
    const next = draft.trim();
    if (next.length === 0) return;
    if (tags.includes(next)) {
      setDraft("");
      return;
    }
    void edit.commit("tags", [...tags, next]);
    setDraft("");
  }

  function removeTag(tag: string) {
    void edit.commit(
      "tags",
      tags.filter((existing) => existing !== tag),
    );
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <Chip key={tag} variant="neutral">
          {tag}
        </Chip>
      ))}
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("band.addTag", "Add tag")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-[18px] items-center gap-1 rounded-chip border border-dashed border-glass-border px-1.5",
          "font-mono text-[10px] uppercase tracking-[0.12em] text-text-3",
          "transition-colors duration-150 hover:border-glass-border-medium hover:text-text-2",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        )}
      >
        <Plus className="h-2.5 w-2.5" strokeWidth={2} />
        {tags.length === 0 ? t("band.addTag", "Add tag") : null}
      </button>
      <SaveDot state={edit.saveState("tags")} className="ml-0.5" />

      <EditPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        ariaLabel={t("band.tagsLabel", "Tags")}
        width={240}
      >
        <input
          ref={inputRef}
          type="text"
          aria-label={t("band.addTag", "Add tag")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("band.tagPlaceholder", "[ type, then ↵ ]")}
          className={cn(
            "h-9 w-full rounded-[5px] border border-glass-border bg-[var(--surface-input)] px-2",
            "font-mohave text-[14px] text-text outline-none transition-colors duration-150 placeholder:text-text-mute",
            "focus:border-glass-border-strong focus-visible:ring-1 focus-visible:ring-ops-accent",
          )}
        />
        {tags.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-chip border border-glass-border bg-[var(--surface-input)] px-1.5 py-[2px]"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-2">
                  {tag}
                </span>
                <button
                  type="button"
                  aria-label={t("band.removeTag", `Remove ${tag}`)}
                  onClick={() => removeTag(tag)}
                  className="inline-flex h-3 w-3 items-center justify-center text-text-3 transition-colors hover:text-rose focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                >
                  <X className="h-2.5 w-2.5" strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </EditPopover>
    </span>
  );
}

// ─── TextAreaField ───────────────────────────────────────────────────────────────

export function TextAreaField({
  edit,
  canManage,
  value,
  className,
}: BaseFieldProps & { value: string | null }) {
  const { t } = useDictionary("pipeline");
  const fieldId = useId();
  const [draft, setDraft] = useState(value ?? "");
  const escapedRef = useRef(false);

  // Keep the draft in sync when the upstream value changes (e.g. optimistic
  // patch settles or another surface edits the same field).
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  if (!canManage) {
    const empty = (value ?? "").trim().length === 0;
    return (
      <p
        className={cn(
          "whitespace-pre-wrap font-mohave text-[14px] leading-[1.55] text-text-2",
          className,
        )}
      >
        {empty ? <span className="text-text-3">{EMPTY}</span> : value}
      </p>
    );
  }

  function commitIfChanged() {
    if (escapedRef.current) {
      escapedRef.current = false;
      return;
    }
    const next = draft;
    const prior = value ?? "";
    if (next === prior) return;
    void edit.commit("description", next);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      escapedRef.current = true;
      setDraft(value ?? "");
      event.currentTarget.blur();
    }
  }

  return (
    <div className={cn("relative", className)}>
      <TextArea
        id={fieldId}
        aria-label={t("detail.scopeLabel", "Scope")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commitIfChanged}
        placeholder={t("detail.scopePlaceholder", "[ no scope captured ]")}
        className="min-h-[88px] focus-visible:ring-1 focus-visible:ring-ops-accent"
      />
      <SaveDot
        state={edit.saveState("description")}
        className="absolute right-2 top-2"
      />
    </div>
  );
}

// ─── AddressField ────────────────────────────────────────────────────────────────

export function AddressField({
  edit,
  canManage,
  value,
  className,
}: BaseFieldProps & { value: { address: string | null; latitude: number | null; longitude: number | null } }) {
  const { t } = useDictionary("pipeline");

  const proximity =
    value.latitude != null && value.longitude != null
      ? { latitude: value.latitude, longitude: value.longitude }
      : undefined;

  if (!canManage) {
    const empty = (value.address ?? "").trim().length === 0;
    return (
      <p
        className={cn("font-mohave text-[14px] leading-[1.5] text-text-2", className)}
      >
        {empty ? <span className="text-text-3">{EMPTY}</span> : value.address}
      </p>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <AddressAutocomplete
        value={value.address ?? ""}
        proximity={proximity}
        portalListbox
        onChange={(selection: AddressEditValue) => edit.commit("address", selection)}
        ariaLabel={t("detail.addressLabel", "Address")}
      />
      <SaveDot
        state={edit.saveState("address")}
        className="absolute right-2 top-1/2 -translate-y-1/2"
      />
    </div>
  );
}
