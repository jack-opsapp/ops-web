"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useInventoryTags,
  useBulkSetTags,
} from "@/lib/hooks/use-inventory";
import { toast } from "sonner";

// ─── Props ──────────────────────────────────────────────────────────────────────

interface BulkTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItemIds: string[];
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function BulkTagsDialog({
  open,
  onOpenChange,
  selectedItemIds,
}: BulkTagsDialogProps) {
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: tags = [] } = useInventoryTags();
  const bulkSetTags = useBulkSetTags();

  const itemCount = selectedItemIds.length;

  // Reset on open
  useEffect(() => {
    if (open) {
      setSelectedTagIds(new Set());
    }
  }, [open]);

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  }

  async function handleApply() {
    if (itemCount === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await bulkSetTags.mutateAsync({
        itemIds: selectedItemIds,
        tagIds: Array.from(selectedTagIds),
      });
      toast.success(
        `Tags applied to ${itemCount} item${itemCount === 1 ? "" : "s"}`
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to apply tags"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Set Tags</DialogTitle>
          <DialogDescription>
            Select tags to apply to {itemCount} item
            {itemCount === 1 ? "" : "s"}. This will replace existing tags.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {tags.length === 0 ? (
            <p className="text-text-tertiary text-body-sm font-mohave text-center py-3">
              No tags available. Create tags in the Tags &amp; Units tab.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto">
              {tags.map((tag) => {
                const isSelected = selectedTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-1.5 py-1.5 rounded-sm",
                      "text-body-sm font-mohave text-left",
                      "transition-colors duration-100",
                      isSelected
                        ? "bg-[rgba(255,255,255,0.08)] text-text-primary"
                        : "text-text-secondary hover:bg-[rgba(255,255,255,0.04)]"
                    )}
                    onClick={() => toggleTag(tag.id)}
                  >
                    <div
                      className={cn(
                        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border",
                        isSelected
                          ? "border-ops-accent bg-ops-accent"
                          : "border-[rgba(255,255,255,0.2)] bg-transparent"
                      )}
                    >
                      {isSelected && (
                        <Check className="h-[12px] w-[12px] text-white" />
                      )}
                    </div>
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleApply}
            loading={saving}
          >
            Apply to {itemCount} Item{itemCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
