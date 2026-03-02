"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateSnapshot,
  useInventoryItems,
  useInventoryUnits,
  useInventoryItemTags,
  useInventoryTags,
} from "@/lib/hooks/use-inventory";
import { useAuthStore } from "@/lib/store/auth-store";

interface SnapshotCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SnapshotCreateDialog({
  open,
  onOpenChange,
}: SnapshotCreateDialogProps) {
  const { currentUser, company } = useAuthStore();
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? "";

  const { data: items = [] } = useInventoryItems();
  const { data: units = [] } = useInventoryUnits();
  const { data: itemTags = [] } = useInventoryItemTags();
  const { data: tags = [] } = useInventoryTags();

  const createSnapshot = useCreateSnapshot();

  const [notes, setNotes] = useState("");

  const handleCreate = () => {
    if (!companyId || !userId) return;

    const activeItems = items.filter((i) => !i.deletedAt);

    createSnapshot.mutate(
      {
        companyId,
        userId,
        isAutomatic: false,
        items: activeItems,
        units,
        itemTags,
        tags,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          setNotes("");
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            CREATE SNAPSHOT
          </DialogTitle>
          <DialogDescription className="font-mohave text-body-sm text-text-tertiary">
            Capture a point-in-time record of your current inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Notes */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Notes (optional)
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this snapshot..."
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-1.5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={createSnapshot.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleCreate}
              loading={createSnapshot.isPending}
              className="gap-1"
            >
              <Camera className="w-[14px] h-[14px]" />
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
