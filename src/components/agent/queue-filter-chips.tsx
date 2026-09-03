"use client";

/**
 * QueueFilterChips — the agent queue's type + priority filters.
 *
 *   [ ALL TYPES ⌄ ]  [ ALL PRIORITIES ⌄ ]   ← two chips, each → portaled picker
 *
 * The queue carries up to ~20 proposal types, and a live company routinely has
 * eight of them pending at once. Rendered as an inline {@link FilterChips} row
 * that breaks the Workbar's overflow contract exactly the way the pipeline's
 * eight stage chips did: the elastic `filters` cell floors at min-content, so
 * the chips wrapped into a multi-row stack that doubled the toolbar's height
 * and pushed the table down the screen (Jackson, 2026-09-03 — "the header area
 * looks pretty bad with all of those chips").
 *
 * A picker trigger's min-content is ONE small chip, so the filters cell can
 * never force row 1 to grow. This is the same construction as
 * `pipeline-filter-chips.tsx`, deliberately — the two surfaces that outgrew
 * inline chips should look and behave identically. Surfaces with few options
 * (Clients, Books, Catalog) keep the inline row.
 *
 * Both filters stay DERIVED: the options are the values actually present in
 * the loaded rows, each with its count, so a filter can never offer a cut that
 * returns nothing.
 */

import { forwardRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { EntityPicker } from "@/components/ui/entity-picker";
import { cn } from "@/lib/utils/cn";

export interface QueueFilterOption<T extends string> {
  id: T;
  label: string;
  /** How many loaded rows carry this value — rendered as the picker's sub-label. */
  count: number;
}

/**
 * The shared filter-chip trigger: the DESIGN.md §9 tag tier (24px,
 * rounded-chip, JetBrains Mono micro uppercase, 0.12em) rendered as a button.
 * Filled while the picker is open OR a filter is applied, so a scanning
 * operator sees at a glance that the queue is narrowed.
 *
 * MUST forward ref and spread props: `PickerTrigger asChild` clones this
 * element to attach the popover's `onPointerDown`, `aria-expanded`, and its
 * positioning ref. A plain function component swallows them and the picker
 * silently never opens.
 */
const FilterPickerChipTrigger = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    open: boolean;
    filtered: boolean;
  } & React.ComponentPropsWithoutRef<"button">
>(function FilterPickerChipTrigger(
  { label, open, filtered, className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={cn(
        "inline-flex h-3 items-center gap-0.5 rounded-chip border px-1",
        "font-mono text-micro font-medium uppercase tracking-[0.12em]",
        "transition-colors duration-150 ease-smooth",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        open || filtered
          ? "border-line-hi bg-surface-active text-text"
          : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
        className
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      <ChevronDown
        className={cn(
          "h-2 w-2 shrink-0 transition-transform duration-150",
          open && "rotate-180"
        )}
        strokeWidth={1.5}
      />
    </button>
  );
});

function QueuePickerChip<T extends string>({
  value,
  options,
  allLabel,
  onChange,
}: {
  value: T | "all";
  options: QueueFilterOption<T>[];
  allLabel: string;
  onChange: (value: T | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const filtered = value !== "all";
  const active = options.find((o) => o.id === value);

  return (
    <div className="inline-flex" data-keyboard-scope="modal-or-menu">
      <EntityPicker<QueueFilterOption<T>>
        trigger={
          <FilterPickerChipTrigger
            label={active?.label ?? allLabel}
            open={open}
            filtered={filtered}
          />
        }
        open={open}
        onOpenChange={setOpen}
        label={allLabel}
        items={options}
        value={filtered ? value : null}
        onChange={(id) => onChange((id ?? "all") as T | "all")}
        getId={(o) => o.id}
        getLabel={(o) => o.label}
        getSubLabel={(o) => String(o.count)}
        // Short, known labels — a search box would be noise.
        searchable={false}
        noneOption
        noneLabel={allLabel}
        size="md"
      />
    </div>
  );
}

export function QueueFilterChips<TType extends string, TPriority extends string>({
  typeValue,
  typeOptions,
  allTypesLabel,
  onTypeChange,
  priorityValue,
  priorityOptions,
  allPrioritiesLabel,
  onPriorityChange,
}: {
  typeValue: TType | "all";
  typeOptions: QueueFilterOption<TType>[];
  allTypesLabel: string;
  onTypeChange: (value: TType | "all") => void;
  priorityValue: TPriority | "all";
  priorityOptions: QueueFilterOption<TPriority>[];
  allPrioritiesLabel: string;
  onPriorityChange: (value: TPriority | "all") => void;
}) {
  return (
    // ONE unwrappable flex item, deliberately: the Workbar's filters cell is
    // `flex-wrap`, so two loose chips still break onto separate lines whenever
    // the right cluster is wide. Keeping the pair `flex-nowrap` raises the
    // cell's min-content floor from one chip to two — still tiny and bounded.
    <div className="flex flex-nowrap items-center gap-2">
      {typeOptions.length > 1 && (
        <QueuePickerChip<TType>
          value={typeValue}
          options={typeOptions}
          allLabel={allTypesLabel}
          onChange={onTypeChange}
        />
      )}
      {priorityOptions.length > 1 && (
        <QueuePickerChip<TPriority>
          value={priorityValue}
          options={priorityOptions}
          allLabel={allPrioritiesLabel}
          onChange={onPriorityChange}
        />
      )}
    </div>
  );
}
