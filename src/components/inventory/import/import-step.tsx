"use client";

import { useState, useCallback } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  useCreateInventoryItem,
  useCreateInventoryTag,
  useSetItemTags,
  useInventoryTags,
  useInventoryUnits,
} from "@/lib/hooks/use-inventory";
import { useAuthStore } from "@/lib/store/auth-store";
import type { PreviewItem } from "./preview-step";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportStepProps {
  items: PreviewItem[];
  onDone: () => void;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ImportStep({ items, onDone }: ImportStepProps) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const createItem = useCreateInventoryItem();
  const createTag = useCreateInventoryTag();
  const setItemTags = useSetItemTags();
  const { data: existingTags = [] } = useInventoryTags();
  const { data: existingUnits = [] } = useInventoryUnits();

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);

  const total = items.length;
  const progressPct = total > 0 ? Math.round((progress / total) * 100) : 0;

  const handleImport = useCallback(async () => {
    if (!companyId || items.length === 0) return;

    setImporting(true);
    setProgress(0);
    setResult(null);

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    // Build a cache of tag name -> id (case-insensitive)
    const tagCache = new Map<string, string>();
    for (const tag of existingTags) {
      tagCache.set(tag.name.toLowerCase(), tag.id);
    }

    // Build a cache of unit display -> id (case-insensitive)
    const unitCache = new Map<string, string>();
    for (const unit of existingUnits) {
      unitCache.set(unit.display.toLowerCase(), unit.id);
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        if (!item.name.trim()) {
          skipped++;
          setProgress(i + 1);
          continue;
        }

        // Resolve unit
        const unitId = item.unit
          ? (unitCache.get(item.unit.toLowerCase()) ?? null)
          : null;

        // Create item
        const created = await createItem.mutateAsync({
          companyId,
          name: item.name.trim(),
          quantity: item.quantity,
          unitId,
          sku: item.sku.trim() || null,
          description: item.description.trim() || null,
          notes: item.notes.trim() || null,
          imageUrl: null,
          warningThreshold: null,
          criticalThreshold: null,
        });

        // Handle tags
        if (item.tags.trim()) {
          const tagNames = item.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

          const tagIds: string[] = [];
          for (const tagName of tagNames) {
            const lowerName = tagName.toLowerCase();
            let tagId = tagCache.get(lowerName);

            if (!tagId) {
              // Create the tag
              const newTag = await createTag.mutateAsync({
                companyId,
                name: tagName,
              });
              tagId = newTag.id;
              tagCache.set(lowerName, tagId);
            }

            tagIds.push(tagId);
          }

          if (tagIds.length > 0) {
            await setItemTags.mutateAsync({
              itemId: created.id,
              tagIds,
            });
          }
        }

        imported++;
      } catch {
        errors++;
      }

      setProgress(i + 1);
    }

    setResult({ imported, skipped, errors });
    setImporting(false);
  }, [
    companyId,
    items,
    existingTags,
    existingUnits,
    createItem,
    createTag,
    setItemTags,
  ]);

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {/* Pre-import state */}
      {!importing && !result && (
        <>
          <p className="font-mohave text-body text-text-primary text-center">
            Ready to import {total} item{total !== 1 ? "s" : ""} into your
            inventory
          </p>
          <Button
            variant="primary"
            size="lg"
            onClick={handleImport}
            disabled={!companyId || total === 0}
          >
            Start Import
          </Button>
        </>
      )}

      {/* Importing state */}
      {importing && (
        <>
          <p className="font-mohave text-body text-text-primary">
            Importing... {progress} of {total}
          </p>
          <div className="w-full max-w-md">
            <Progress value={progressPct} glow />
          </div>
          <p className="font-mohave text-caption-sm text-text-tertiary">
            Please do not close this page
          </p>
        </>
      )}

      {/* Result state */}
      {result && (
        <>
          <div
            className={cn(
              "flex flex-col items-center gap-3 p-6 rounded-md border",
              result.errors === 0
                ? "border-status-success/30 bg-status-success/5"
                : "border-status-warning/30 bg-status-warning/5"
            )}
          >
            {result.errors === 0 ? (
              <CheckCircle className="h-8 w-8 text-status-success" />
            ) : (
              <AlertCircle className="h-8 w-8 text-status-warning" />
            )}

            <p className="font-mohave text-body-lg text-text-primary">
              Import Complete
            </p>

            <div className="flex flex-col items-center gap-1">
              <p className="font-mohave text-body text-text-secondary">
                {result.imported} imported
              </p>
              {result.skipped > 0 && (
                <p className="font-mohave text-body-sm text-text-tertiary">
                  {result.skipped} skipped (empty name)
                </p>
              )}
              {result.errors > 0 && (
                <p className="font-mohave text-body-sm text-ops-error">
                  {result.errors} error{result.errors !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>

          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </>
      )}
    </div>
  );
}
