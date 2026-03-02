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
import {
  useCreateInventoryTag,
  useUpdateInventoryTag,
} from "@/lib/hooks/use-inventory";
import { useAuthStore } from "@/lib/store/auth-store";
import type { InventoryTag } from "@/lib/types/inventory";

interface TagFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTag?: InventoryTag | null;
}

export function TagFormDialog({ open, onOpenChange, editTag }: TagFormDialogProps) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const createTag = useCreateInventoryTag();
  const updateTag = useUpdateInventoryTag();

  const isEditing = !!editTag;

  const [name, setName] = useState("");
  const [warningThreshold, setWarningThreshold] = useState("");
  const [criticalThreshold, setCriticalThreshold] = useState("");

  // Reset form when dialog opens or editTag changes
  useEffect(() => {
    if (open) {
      if (editTag) {
        setName(editTag.name);
        setWarningThreshold(
          editTag.warningThreshold != null ? String(editTag.warningThreshold) : ""
        );
        setCriticalThreshold(
          editTag.criticalThreshold != null ? String(editTag.criticalThreshold) : ""
        );
      } else {
        setName("");
        setWarningThreshold("");
        setCriticalThreshold("");
      }
    }
  }, [open, editTag]);

  const handleSubmit = () => {
    if (!name.trim()) return;

    const warningVal = warningThreshold.trim()
      ? parseFloat(warningThreshold)
      : null;
    const criticalVal = criticalThreshold.trim()
      ? parseFloat(criticalThreshold)
      : null;

    if (isEditing && editTag) {
      updateTag.mutate(
        {
          id: editTag.id,
          data: {
            name: name.trim(),
            warningThreshold: warningVal,
            criticalThreshold: criticalVal,
          },
        },
        { onSuccess: () => onOpenChange(false) }
      );
    } else {
      createTag.mutate(
        {
          companyId,
          name: name.trim(),
          warningThreshold: warningVal,
          criticalThreshold: criticalVal,
        },
        { onSuccess: () => onOpenChange(false) }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            {isEditing ? "Edit Tag" : "New Tag"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Name */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fasteners, Safety Gear"
            />
          </div>

          {/* Thresholds */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Warning Threshold
              </label>
              <Input
                type="number"
                min={0}
                value={warningThreshold}
                onChange={(e) => setWarningThreshold(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Critical Threshold
              </label>
              <Input
                type="number"
                min={0}
                value={criticalThreshold}
                onChange={(e) => setCriticalThreshold(e.target.value)}
                placeholder="Optional"
              />
            </div>
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
              disabled={!name.trim() || createTag.isPending || updateTag.isPending}
              loading={createTag.isPending || updateTag.isPending}
            >
              {isEditing ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
