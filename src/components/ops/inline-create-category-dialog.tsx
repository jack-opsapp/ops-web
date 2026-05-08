"use client";

/**
 * InlineCreateCategoryDialog — minimal "+ NEW CATEGORY" sheet, opened by
 * the CategoryPicker. Single field (name). On save, inserts a new
 * `catalog_categories` row via `useCreateCatalogCategory`, then hands
 * the new id+name back to the parent picker via `onCreated` so the form
 * continues writing both the FK and the legacy text column.
 *
 * Mirrors the iOS `InlineCreateCategorySheet` UX: tight presentation,
 * autofocused name field, Enter to save, Escape to cancel.
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateCatalogCategory } from "@/lib/hooks/use-catalog-lookups";

export interface InlineCreateCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /**
   * Fires after a successful insert. Carries the newly created category's
   * id + name so the picker can select it without waiting for the cache
   * refetch round-trip.
   */
  onCreated: (id: string, name: string) => void;
}

export function InlineCreateCategoryDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: InlineCreateCategoryDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const createCategory = useCreateCatalogCategory();
  const isSaving = createCategory.isPending;

  // Reset local state when the dialog opens or closes so re-opening the
  // sheet always shows an empty form.
  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      // Match iOS sheet timing — short delay to let the dialog finish
      // its mount animation before stealing focus.
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !isSaving;

  async function handleSave() {
    if (!canSave) return;
    setError(null);
    try {
      const created = await createCategory.mutateAsync({
        companyId,
        name: trimmed,
      });
      onCreated(created.id, created.name);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create category");
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
            {"// NEW CATEGORY"}
          </p>
          <DialogTitle className="font-cakemono font-light uppercase tracking-[0.14em] text-[18px]">
            Add a category
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          <div className="space-y-0.5">
            <label
              htmlFor="inline-create-category-name"
              className="font-mono text-caption-sm text-text-3 uppercase tracking-widest"
            >
              Name *
            </label>
            <Input
              ref={inputRef}
              id="inline-create-category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Hardware"
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
            />
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
