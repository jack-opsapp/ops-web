"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateInventoryUnit } from "@/lib/hooks/use-inventory";
import { useAuthStore } from "@/lib/store/auth-store";

interface UnitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UnitFormDialog({ open, onOpenChange }: UnitFormDialogProps) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const createUnit = useCreateInventoryUnit();

  const [display, setDisplay] = useState("");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setDisplay("");
    }
  }, [open]);

  const handleSubmit = () => {
    if (!display.trim()) return;

    createUnit.mutate(
      {
        companyId,
        display: display.trim(),
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[360px]">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            New Unit
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Display name */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Display Name *
            </label>
            <Input
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
              placeholder="e.g. rolls, boxes, gallons"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-1.5 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSubmit}
              disabled={!display.trim() || createUnit.isPending}
              loading={createUnit.isPending}
            >
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
