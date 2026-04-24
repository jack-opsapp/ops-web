"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { CommsConfigWizard } from "@/components/agent/comms-config-wizard";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Full-screen overlay that hosts the existing CommsConfigWizard. Replaces
 * the legacy /agent/comms-config page mount. Dense-glass background, 12px
 * modal radius, inset 48px so the deck is visible underneath the scrim.
 */
export function CommsConfigOverlay({ open, onOpenChange }: Props) {
  const { t } = useDictionary("calibration");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[2900]" />
        <Dialog.Content
          className="fixed inset-12 z-[3000] glass-dense rounded-modal overflow-hidden flex flex-col"
          onEscapeKeyDown={() => onOpenChange(false)}
        >
          <div className="flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.08)]">
            <Dialog.Title className="font-cakemono font-light uppercase text-[18px] text-text">
              {t("sections.config.autonomy.title")} · WIZARD
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="p-2 text-text-mute hover:text-text-2 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <CommsConfigWizard />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
