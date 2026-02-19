"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MarkupCanvas, type MarkupCanvasRef } from "./markup-canvas";
import { MarkupToolbar } from "./markup-toolbar";
import { uploadImage } from "@/lib/api/services/image-service";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PhotoMarkupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onSave: (markedUpUrl: string) => void;
}

export function PhotoMarkupDialog({
  open,
  onOpenChange,
  imageUrl,
  onSave,
}: PhotoMarkupDialogProps) {
  const canvasRef = useRef<MarkupCanvasRef>(null);
  const [color, setColor] = useState("#FF0000");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [isSaving, setIsSaving] = useState(false);
  const [pathCount, setPathCount] = useState(0);

  async function handleSave() {
    if (!canvasRef.current) return;

    const dataUrl = canvasRef.current.exportImage();
    if (!dataUrl) return;

    setIsSaving(true);
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "markup.jpg", { type: "image/jpeg" });
      const url = await uploadImage(file);
      onSave(url);
      onOpenChange(false);
    } catch {
      toast.error("Failed to save markup");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-white/10 bg-[#111]">
        <DialogHeader>
          <DialogTitle className="text-[#E5E5E5]">
            Mark Up Photo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <MarkupToolbar
            color={color}
            onColorChange={setColor}
            strokeWidth={strokeWidth}
            onStrokeWidthChange={setStrokeWidth}
            onUndo={() => {
              canvasRef.current?.undo();
              setPathCount((c) => Math.max(0, c - 1));
            }}
            onClear={() => {
              canvasRef.current?.clear();
              setPathCount(0);
            }}
            canUndo={pathCount > 0}
          />

          <div className="flex justify-center">
            <MarkupCanvas
              ref={canvasRef}
              imageUrl={imageUrl}
              width={700}
              height={500}
              strokeColor={color}
              strokeWidth={strokeWidth}
            />
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
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-md bg-[#417394] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4d8ab0] disabled:opacity-50"
          >
            {isSaving && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Save Markup
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
