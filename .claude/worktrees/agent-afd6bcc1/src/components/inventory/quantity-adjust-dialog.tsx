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
import { useUpdateInventoryItem } from "@/lib/hooks/use-inventory";
import type { InventoryItem } from "@/lib/types/inventory";
import { toast } from "sonner";

// ─── Props ──────────────────────────────────────────────────────────────────────

interface QuantityAdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem;
  unitDisplay?: string;
}

// ─── Presets ────────────────────────────────────────────────────────────────────

const PRESETS = [-100, -50, -10, -1, 1, 10, 50, 100];

// ─── Component ──────────────────────────────────────────────────────────────────

export function QuantityAdjustDialog({
  open,
  onOpenChange,
  item,
  unitDisplay,
}: QuantityAdjustDialogProps) {
  const [delta, setDelta] = useState(0);
  const [customDelta, setCustomDelta] = useState("");
  const [saving, setSaving] = useState(false);

  const updateItem = useUpdateInventoryItem();

  // Reset on open
  useEffect(() => {
    if (open) {
      setDelta(0);
      setCustomDelta("");
    }
  }, [open]);

  const newQuantity = Math.max(0, item.quantity + delta);
  const unitSuffix = unitDisplay ? ` ${unitDisplay}` : "";

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
    if (delta === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await updateItem.mutateAsync({
        id: item.id,
        data: { quantity: newQuantity },
      });
      toast.success(`Quantity updated to ${newQuantity}${unitSuffix}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update quantity"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Adjust Quantity</DialogTitle>
          <DialogDescription>
            {item.name} &mdash; Current: {item.quantity}
            {unitSuffix}
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

          {/* Live preview */}
          <div
            className={cn(
              "text-text-secondary font-mono text-body-sm",
              "py-1.5 px-1.5",
              "bg-[rgba(255,255,255,0.03)] rounded-sm border border-[rgba(255,255,255,0.06)]"
            )}
          >
            New quantity:{" "}
            <span className="text-text-primary">
              {newQuantity}
              {unitSuffix}
            </span>
            {delta !== 0 && (
              <span
                className={cn(
                  "ml-1",
                  delta > 0 ? "text-ops-green" : "text-ops-error"
                )}
              >
                ({delta > 0 ? "+" : ""}
                {delta})
              </span>
            )}
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
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
