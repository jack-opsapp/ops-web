"use client";

/**
 * CategoryPicker — popover combobox over `catalog_categories` for the
 * active company. Searchable list + a divider + a trailing
 * "+ NEW CATEGORY…" item that fires `onCreateNew`. Keyboard navigation
 * (arrow up/down + Enter + Escape) is provided by cmdk.
 *
 * The `onChange` callback hands back BOTH the FK id and the matching
 * category name so the form can keep writing the legacy free-text
 * `category` column lockstep with the new `category_id` FK. A null id
 * with null name represents an explicit "no category" selection.
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
  type CatalogCategoryLookup,
} from "@/lib/hooks/use-catalog-lookups";

export interface CategoryPickerProps {
  /** The currently selected `catalog_categories.id`, or null/undefined. */
  value: string | null | undefined;
  /**
   * Fires whenever the user picks a category, clears the selection, or
   * picks the inline "None" entry. Both id and name are emitted so the
   * caller can mirror the legacy text column.
   */
  onChange: (id: string | null, name: string | null) => void;
  /**
   * Fires when the user picks "+ NEW CATEGORY…". The caller is expected
   * to open the inline-create dialog and, on success, call `onChange`
   * with the new id + name.
   */
  onCreateNew: () => void;
  /** Optional placeholder shown when no value is selected. */
  placeholder?: string;
  /** Optional id passed through to the trigger button (form labels). */
  id?: string;
  /** Optional disabled state. */
  disabled?: boolean;
}

export function CategoryPicker({
  value,
  onChange,
  onCreateNew,
  placeholder = "Select category",
  id,
  disabled,
}: CategoryPickerProps) {
  const { categories } = useCatalogLookups();
  const [open, setOpen] = useState(false);

  const sorted = useMemo<CatalogCategoryLookup[]>(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  const selected = useMemo(
    () => sorted.find((c) => c.id === value) ?? null,
    [sorted, value]
  );

  const triggerLabel = selected?.name ?? placeholder;
  const isPlaceholder = !selected;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={selected ? `Category: ${selected.name}` : placeholder}
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
          <CommandInput placeholder="Search categories…" />
          <CommandList>
            <CommandEmpty>No categories found</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  onChange(null, null);
                  setOpen(false);
                }}
              >
                <span className="flex-1 text-text-3">None</span>
                {value == null && (
                  <Check className="w-[14px] h-[14px] text-text-2 shrink-0" />
                )}
              </CommandItem>
              {sorted.map((category) => {
                const isSelected = category.id === value;
                return (
                  <CommandItem
                    key={category.id}
                    value={category.name}
                    onSelect={() => {
                      onChange(category.id, category.name);
                      setOpen(false);
                    }}
                  >
                    <span className="flex-1 truncate">{category.name}</span>
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
                  New category…
                </span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
