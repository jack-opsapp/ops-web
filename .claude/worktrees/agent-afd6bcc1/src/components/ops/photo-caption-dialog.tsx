"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

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
      <DialogContent className="max-w-md border-white/10 bg-[#111]">
        <DialogHeader>
          <DialogTitle className="text-[#E5E5E5]">
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
            className="w-full resize-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[#E5E5E5] placeholder:text-[#666] focus:border-[#417394] focus:outline-none"
          />
          <div className="text-right text-xs text-[#666]">
            {caption.length}/200
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-sm text-[#999] hover:text-[#E5E5E5]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-[#417394] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4d8ab0]"
          >
            Save Caption
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
