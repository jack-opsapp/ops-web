"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import {
  Picker,
  PickerTrigger,
  PickerContent,
  PickerSearch,
  PickerList,
  PickerEmpty,
  PickerItem,
  PickerFooterAction,
} from "@/components/ui/picker";
import { UserAvatar } from "@/components/ops/user-avatar";

export interface EntityAvatar {
  name: string;
  imageUrl?: string | null;
}

interface EntityPickerBaseProps<T> {
  /** Trigger node — rendered via PickerTrigger asChild. */
  trigger: React.ReactNode;
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  /** Right-aligned secondary text (e.g. a unit abbreviation). */
  getSubLabel?: (item: T) => React.ReactNode;
  /** Leading avatar descriptor. */
  getAvatar?: (item: T) => EntityAvatar | null | undefined;
  /** Arbitrary leading node (e.g. a semantic status dot). `getAvatar` wins when both return something. */
  getLeading?: (item: T) => React.ReactNode;
  /** Advisory line under a row (e.g. a schedule conflict). Multi-select only in practice. */
  conflictFor?: (id: string) => React.ReactNode | null | undefined;
  /** Accessible name for the popover. */
  label: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** data-testid for the search input (unit/e2e hook). */
  searchTestId?: string;
  clearLabel?: string;
  emptyLabel?: React.ReactNode;
  /**
   * Footer create action ("+ New …"). Hidden in read-only. Both members
   * receive the live search query, so a caller can offer query-seeded
   * creation — label `(q) => q ? `New client "${q}"` : "New client"`,
   * onCreate `(q) => createAndLink(q)`. Existing `() => void` callers are
   * unaffected (the argument is simply ignored).
   */
  createAction?: {
    label: React.ReactNode | ((query: string) => React.ReactNode);
    onCreate: (query: string) => void;
  };
  /** Read-only (e.g. RLS 42501) — rows non-interactive + a notice. */
  readOnly?: boolean;
  readOnlyLabel?: React.ReactNode;
  /** Inline error (e.g. mutation failure). */
  error?: React.ReactNode;
  /** Controlled open (optional — uncontrolled by default). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: "sm" | "md" | "lg" | "auto";
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  /**
   * Extra classes on the popover panel. The one sanctioned use is a z-layer
   * override (`z-modal`) when the trigger lives inside a floating window
   * (windows sit at z 2000+, above the default `z-dropdown` 1000).
   */
  contentClassName?: string;
}

interface SingleProps<T> extends EntityPickerBaseProps<T> {
  multiple?: false;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Leading "— none" row (single-select only). */
  noneOption?: boolean;
  noneLabel?: React.ReactNode;
}

interface MultiProps<T> extends EntityPickerBaseProps<T> {
  multiple: true;
  value: string[];
  onChange: (ids: string[]) => void;
}

export type EntityPickerProps<T> = SingleProps<T> | MultiProps<T>;

/**
 * EntityPicker — search + single/multi select with optional avatars,
 * sub-labels, a "none" row, an inline create action, and per-row conflict
 * advisories. The one component behind client, team, assignee, category, unit.
 * Presentation only — data lives in the caller's hooks. Optimistic: single
 * commits + closes; multi toggles and stays open. No Apply button.
 */
export function EntityPicker<T>(props: EntityPickerProps<T>) {
  const {
    trigger,
    items,
    getId,
    getLabel,
    getSubLabel,
    getAvatar,
    getLeading,
    conflictFor,
    label,
    searchable = true,
    searchPlaceholder,
    searchTestId,
    clearLabel,
    emptyLabel,
    createAction,
    readOnly,
    readOnlyLabel,
    error,
    open,
    onOpenChange,
    size = "md",
    align = "start",
    side = "bottom",
    contentClassName,
  } = props;

  const [search, setSearch] = React.useState("");
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = open ?? internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
      if (!next) setSearch("");
    },
    [onOpenChange],
  );

  const selectedIds = props.multiple ? props.value : [];
  const singleValue = props.multiple ? null : props.value;
  const isSelected = (id: string) =>
    props.multiple ? selectedIds.includes(id) : singleValue === id;

  function handleSelect(id: string) {
    if (readOnly) return;
    if (props.multiple) {
      const next = props.value.includes(id)
        ? props.value.filter((x) => x !== id)
        : [...props.value, id];
      props.onChange(next);
    } else {
      props.onChange(id);
      setOpen(false);
    }
  }

  return (
    <Picker open={isOpen} onOpenChange={setOpen}>
      <PickerTrigger asChild>{trigger}</PickerTrigger>
      <PickerContent
        label={label}
        size={size}
        align={align}
        side={side}
        shouldFilter={searchable}
        className={contentClassName}
      >
        {searchable ? (
          <PickerSearch
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            clearLabel={clearLabel}
            data-testid={searchTestId}
          />
        ) : null}

        {readOnly && readOnlyLabel ? (
          <p className="px-[12px] pb-[4px] pt-[8px] font-mono text-micro uppercase tracking-wider text-text-3">
            {readOnlyLabel}
          </p>
        ) : null}

        <PickerList>
          <PickerEmpty>{emptyLabel ?? "—"}</PickerEmpty>

          {!props.multiple && props.noneOption ? (
            <PickerItem
              value={
                typeof props.noneLabel === "string" ? props.noneLabel : "__none__"
              }
              selected={singleValue == null}
              disabled={readOnly}
              onSelect={() => {
                if (readOnly) return;
                props.onChange(null);
                setOpen(false);
              }}
            >
              <span className="text-text-3">{props.noneLabel ?? "—"}</span>
            </PickerItem>
          ) : null}

          {items.map((item) => {
            const id = getId(item);
            const labelText = getLabel(item);
            const avatar = getAvatar?.(item);
            const conflict = conflictFor?.(id);
            const sub = getSubLabel?.(item);
            return (
              <PickerItem
                key={id}
                value={labelText}
                multiple={props.multiple}
                selected={isSelected(id)}
                disabled={readOnly}
                onSelect={() => handleSelect(id)}
                leading={
                  avatar ? (
                    <UserAvatar name={avatar.name} imageUrl={avatar.imageUrl} size="sm" />
                  ) : (
                    getLeading?.(item) ?? undefined
                  )
                }
                subLabel={conflict ?? undefined}
                trailing={
                  sub != null ? (
                    <span className="shrink-0 font-mono text-micro text-text-3">{sub}</span>
                  ) : undefined
                }
              >
                {labelText}
              </PickerItem>
            );
          })}
        </PickerList>

        {error ? (
          <p className="border-t border-border-subtle px-[12px] py-[8px] font-mono text-micro text-rose">
            {error}
          </p>
        ) : null}

        {createAction && !readOnly ? (
          <PickerFooterAction
            icon={<Plus className="h-[16px] w-[16px]" strokeWidth={1.5} aria-hidden="true" />}
            onClick={() => createAction.onCreate(search)}
          >
            {typeof createAction.label === "function"
              ? createAction.label(search)
              : createAction.label}
          </PickerFooterAction>
        ) : null}
      </PickerContent>
    </Picker>
  );
}
