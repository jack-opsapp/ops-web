"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PhotoCaptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  initialCaption: string | null;
  onSave: (caption: string | null) => void;
}

export function PhotoCaptionDialog({
  open,
  onOpenChange,
  imageUrl,
  initialCaption,
  onSave,
}: PhotoCaptionDialogProps) {
  const [caption, setCaption] = useState(initialCaption ?? "");

  function handleSave() {
    onSave(caption.trim() || null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-surface-input">
        <DialogHeader>
          <DialogTitle className="text-[#EDEDED]">
            Photo Caption
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <img
            src={imageUrl}
            alt="Photo to caption"
            className="max-h-64 w-full rounded-lg object-contain"
          />
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption..."
            maxLength={200}
            rows={2}
            className="w-full resize-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[#EDEDED] placeholder:text-[#666] focus:border-[#417394] focus:outline-none"
          />
          <div className="text-right text-xs text-[#666]">
            {caption.length}/200
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSave}>
            Save Caption
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
