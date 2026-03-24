"use client";

import { useDictionary } from "@/i18n/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ComposeEmailForm } from "./compose-email-form";
import type { ComposeEmailData } from "@/lib/types/email-template";

// ─── Props ──────────────────────────────────────────────────────────────────

interface ComposeEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  composeData?: ComposeEmailData;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ComposeEmailModal({
  open,
  onOpenChange,
  composeData,
}: ComposeEmailModalProps) {
  const { t } = useDictionary("compose");
  const mode = composeData?.mode ?? "new";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[620px] max-h-[90vh] p-0 overflow-hidden flex flex-col"
        hideClose
      >
        {/* Header */}
        <div className="shrink-0 px-3 pt-3 pb-2 border-b border-[rgba(255,255,255,0.06)]">
          <DialogHeader className="pb-0">
            <DialogTitle className="text-heading-sm">
              {mode === "reply" ? t("title.reply") : t("title.new")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {mode === "reply" ? t("title.reply") : t("title.new")}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Compose form — all state and logic lives here */}
        <ComposeEmailForm
          composeData={composeData}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
