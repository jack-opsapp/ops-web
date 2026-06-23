"use client";

/**
 * InlineCreateUnitDialog — minimal "+ NEW UNIT" sheet, opened by the
 * UnitPicker. Two fields: display + dimension. On save, inserts a new
 * `catalog_units` row via `useCreateCatalogUnit`, then hands the new
 * id+display back to the parent picker.
 *
 * Mirrors the iOS `InlineCreateUnitSheet` UX. The dimension values match
 * the Postgres check constraint on `catalog_units.dimension` —
 * count/length/area/volume/mass/time. Abbreviation, default flag, and
 * sort order can be edited from the full Units management screen later.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateCatalogUnit } from "@/lib/hooks/use-catalog-lookups";
import {
  CATALOG_UNIT_DIMENSIONS,
  type CatalogUnitDimension,
} from "@/lib/api/services/catalog-unit-service";

const DIMENSION_LABELS: Record<CatalogUnitDimension, string> = {
  count: "Count",
  length: "Length",
  area: "Area",
  volume: "Volume",
  mass: "Mass",
  time: "Time",
};

export interface InlineCreateUnitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /**
   * Fires after a successful insert. Carries the newly created unit's
   * id + display so the picker can select it without waiting for the
   * cache refetch round-trip.
   */
  onCreated: (id: string, display: string) => void;
}

export function InlineCreateUnitDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: InlineCreateUnitDialogProps) {
  const [display, setDisplay] = useState("");
  const [dimension, setDimension] = useState<CatalogUnitDimension>("count");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const createUnit = useCreateCatalogUnit();
  const isSaving = createUnit.isPending;

  useEffect(() => {
    if (open) {
      setDisplay("");
      setDimension("count");
      setError(null);
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  const trimmed = display.trim();
  const canSave = trimmed.length > 0 && !isSaving;

  async function handleSave() {
    if (!canSave) return;
    setError(null);
    try {
      const created = await createUnit.mutateAsync({
        companyId,
        display: trimmed,
        dimension,
      });
      onCreated(created.id, created.display);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create unit");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
            {"// NEW UNIT"}
          </p>
          <DialogTitle className="font-cakemono font-light uppercase tracking-[0.14em] text-[18px]">
            Add a unit
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          <div className="space-y-0.5">
            <label
              htmlFor="inline-create-unit-display"
              className="font-mono text-caption-sm text-text-3 uppercase tracking-widest"
            >
              Display *
            </label>
            <Input
              ref={inputRef}
              id="inline-create-unit-display"
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. BOARD FT"
              maxLength={60}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
              Dimension
            </label>
            <div
              role="radiogroup"
              aria-label="Dimension"
              className={cn(
                "grid grid-cols-3 gap-1 rounded p-0.5",
                "bg-fill-neutral-dim border border-border"
              )}
            >
              {CATALOG_UNIT_DIMENSIONS.map((dim) => {
                const isSelected = dim === dimension;
                return (
                  <button
                    key={dim}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setDimension(dim)}
                    className={cn(
                      "min-h-[36px] px-2 py-1 rounded-chip",
                      "font-cakemono font-light uppercase tracking-[0.14em] text-[11px]",
                      "transition-colors duration-150",
                      "focus:outline-none focus-visible:border-ops-accent",
                      isSelected
                        ? "bg-[rgba(255,255,255,0.08)] text-text border border-[rgba(255,255,255,0.18)]"
                        : "text-text-3 hover:text-text-2 border border-transparent"
                    )}
                  >
                    {DIMENSION_LABELS[dim]}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p
              className="font-mono text-caption-sm text-[#B58289]"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-1.5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
