"use client";

/**
 * UnitPicker — popover combobox over `catalog_units` for the active
 * company. Mirrors `CategoryPicker` exactly: searchable list +
 * "+ NEW UNIT…" affordance. Search matches against both `display` and
 * `abbreviation`.
 *
 * `onChange` hands back BOTH the FK id and the unit's `display` text so
 * the form can keep the legacy free-text `unit` column in sync with the
 * new `unit_id` FK.
 */

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  useCatalogLookups,
  type CatalogUnitLookup,
} from "@/lib/hooks/use-catalog-lookups";

export interface UnitPickerProps {
  /** The currently selected `catalog_units.id`, or null/undefined. */
  value: string | null | undefined;
  /**
   * Fires whenever the user picks a unit or clears the selection. Both
   * id and the unit's `display` text are emitted so callers can mirror
   * the legacy text column.
   */
  onChange: (id: string | null, display: string | null) => void;
  /** Fires when the user picks "+ NEW UNIT…". */
  onCreateNew: () => void;
  /** Optional placeholder shown when no value is selected. */
  placeholder?: string;
  /** Optional id passed through to the trigger button (form labels). */
  id?: string;
  /** Optional disabled state. */
  disabled?: boolean;
}

export function UnitPicker({
  value,
  onChange,
  onCreateNew,
  placeholder = "Select unit",
  id,
  disabled,
}: UnitPickerProps) {
  const { units } = useCatalogLookups();
  const [open, setOpen] = useState(false);

  const sorted = useMemo<CatalogUnitLookup[]>(
    () => [...units].sort((a, b) => a.display.localeCompare(b.display)),
    [units]
  );

  const selected = useMemo(
    () => sorted.find((u) => u.id === value) ?? null,
    [sorted, value]
  );

  const triggerLabel = selected?.display ?? placeholder;
  const isPlaceholder = !selected;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={selected ? `Unit: ${selected.display}` : placeholder}
          className={cn(
            "flex items-center justify-between gap-2 w-full",
            "min-h-[36px] px-2 py-1.5 rounded",
            "bg-fill-neutral-dim border border-border",
            "font-mohave text-body text-left",
            "transition-colors duration-150",
            "focus:outline-none focus-visible:border-ops-accent",
            "data-[state=open]:border-[rgba(255,255,255,0.20)]",
            "disabled:cursor-not-allowed disabled:opacity-40",
            isPlaceholder ? "text-text-3" : "text-text"
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown
            className="w-[14px] h-[14px] text-text-3 shrink-0"
            strokeWidth={1.5}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
      >
        <Command>
          <CommandInput placeholder="Search units…" />
          <CommandList>
            <CommandEmpty>No units found</CommandEmpty>
            <CommandGroup>
              {sorted.map((unit) => {
                const isSelected = unit.id === value;
                // cmdk searches the `value` prop. Including the
                // abbreviation lets users type either "ft" or "feet".
                const searchTokens = [unit.display, unit.abbreviation ?? ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <CommandItem
                    key={unit.id}
                    value={searchTokens}
                    onSelect={() => {
                      onChange(unit.id, unit.display);
                      setOpen(false);
                    }}
                  >
                    <span className="flex-1 truncate">{unit.display}</span>
                    {unit.abbreviation && (
                      <span className="font-mono text-caption-sm text-text-mute uppercase tracking-wider shrink-0">
                        {unit.abbreviation}
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-[14px] h-[14px] text-text-2 shrink-0" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__create_new__"
                onSelect={() => {
                  setOpen(false);
                  onCreateNew();
                }}
                className="text-ops-accent data-[selected=true]:text-ops-accent"
              >
                <Plus
                  className="w-[14px] h-[14px] shrink-0"
                  strokeWidth={1.5}
                />
                <span className="flex-1 font-cakemono font-light uppercase tracking-[0.14em] text-[12px]">
                  New unit…
                </span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
