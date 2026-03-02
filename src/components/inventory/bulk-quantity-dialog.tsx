"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useBulkAdjustQuantity } from "@/lib/hooks/use-inventory";
import { toast } from "sonner";

// ─── Props ──────────────────────────────────────────────────────────────────────

interface BulkQuantityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItemIds: string[];
}

// ─── Presets ────────────────────────────────────────────────────────────────────

const PRESETS = [-100, -50, -10, -1, 1, 10, 50, 100];

// ─── Component ──────────────────────────────────────────────────────────────────

export function BulkQuantityDialog({
  open,
  onOpenChange,
  selectedItemIds,
}: BulkQuantityDialogProps) {
  const [delta, setDelta] = useState(0);
  const [customDelta, setCustomDelta] = useState("");
  const [saving, setSaving] = useState(false);

  const bulkAdjust = useBulkAdjustQuantity();

  // Reset on open
  useEffect(() => {
    if (open) {
      setDelta(0);
      setCustomDelta("");
    }
  }, [open]);

  const itemCount = selectedItemIds.length;

  function applyPreset(value: number) {
    setDelta((prev) => prev + value);
    setCustomDelta("");
  }

  function applyCustom() {
    const parsed = parseInt(customDelta, 10);
    if (isNaN(parsed)) return;
    setDelta((prev) => prev + parsed);
    setCustomDelta("");
  }

  async function handleSave() {
    if (delta === 0 || itemCount === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await bulkAdjust.mutateAsync({
        ids: selectedItemIds,
        delta,
      });
      toast.success(
        `Adjusted quantity by ${delta > 0 ? "+" : ""}${delta} for ${itemCount} item${itemCount === 1 ? "" : "s"}`
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to adjust quantities"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Bulk Adjust Quantity</DialogTitle>
          <DialogDescription>
            Adjusting {itemCount} item{itemCount === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((value) => (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                className="font-mono"
                onClick={() => applyPreset(value)}
              >
                {value > 0 ? `+${value}` : value}
              </Button>
            ))}
          </div>

          {/* Custom input */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                label="Custom Amount"
                type="number"
                placeholder="+/- amount"
                value={customDelta}
                onChange={(e) => setCustomDelta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyCustom();
                  }
                }}
              />
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={applyCustom}
              disabled={customDelta === "" || isNaN(parseInt(customDelta, 10))}
            >
              Apply
            </Button>
          </div>

          {/* Delta preview */}
          <div
            className={cn(
              "text-text-secondary font-mono text-body-sm",
              "py-1.5 px-1.5",
              "bg-[rgba(255,255,255,0.03)] rounded-sm border border-[rgba(255,255,255,0.06)]"
            )}
          >
            Delta:{" "}
            <span
              className={cn(
                "text-text-primary",
                delta > 0 && "text-ops-green",
                delta < 0 && "text-ops-error"
              )}
            >
              {delta > 0 ? "+" : ""}
              {delta}
            </span>{" "}
            applied to each item (minimum 0)
          </div>
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
            onClick={handleSave}
            loading={saving}
            disabled={delta === 0}
          >
            Apply to {itemCount} Item{itemCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
