"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils/cn";

interface RejectDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (notes?: string) => void;
  t: (key: string) => string;
}

export function RejectDialog({ open, onClose, onConfirm, t }: RejectDialogProps) {
  const [notes, setNotes] = useState("");

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <AlertDialogContent className="bg-[var(--surface-glass-dense)] backdrop-blur-[24px] saturate-[1.3] border-[rgba(255,255,255,0.08)]">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-mohave text-body text-text uppercase">
            {t("reject.title")}
          </AlertDialogTitle>
          <AlertDialogDescription className="font-mono text-[13px] text-text-3">
            [{t("reject.description")}]
          </AlertDialogDescription>
        </AlertDialogHeader>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("reject.placeholder")}
          rows={3}
          className={cn(
            "w-full px-3 py-2 rounded-[5px] resize-none",
            "bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)]",
            "font-mono text-[13px] text-text placeholder:text-text-mute",
            "focus:outline-none focus:border-[rgba(255,255,255,0.20)] transition-colors"
          )}
        />

        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onClose}
            className="min-h-[36px] px-4 font-mohave text-body-sm text-text-2 uppercase"
          >
            {t("reject.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm(notes.trim() || undefined);
              setNotes("");
            }}
            className="min-h-[36px] px-4 bg-[rgba(147,50,26,0.15)] text-[#93321A] font-mohave text-body-sm uppercase hover:bg-[rgba(147,50,26,0.25)]"
          >
            {t("reject.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
