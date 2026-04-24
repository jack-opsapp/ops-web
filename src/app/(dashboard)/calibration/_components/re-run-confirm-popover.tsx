"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useDictionary } from "@/i18n/client";
import type { InputSource } from "@/lib/types/calibration";

const SOURCE_LABEL: Record<InputSource, string> = {
  interview: "INTERVIEW",
  scan: "EMAIL SCAN",
  mining: "DATABASE MINING",
};

interface Props {
  source: InputSource;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Re-run confirmation dialog. Dense glass, rendered as a centered modal
 * to keep the trigger-anchored positioning simple — the CTAs live inside
 * a row that may scroll, so anchoring via Popover is brittle.
 */
export function ReRunConfirmPopover({ source, onConfirm, onCancel }: Props) {
  const { t } = useDictionary("calibration");
  const label = SOURCE_LABEL[source];

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[2900]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[3000] glass-dense rounded-modal p-6 min-w-[360px] max-w-[480px]"
          onEscapeKeyDown={onCancel}
        >
          <Dialog.Title className="font-cakemono font-light uppercase text-[18px] text-text">
            {t("sections.inputs.reRunConfirm.title").replace(
              "{source}",
              label
            )}
          </Dialog.Title>
          <Dialog.Description className="mt-2 font-mohave text-body-sm text-text-2">
            {t("sections.inputs.reRunConfirm.body").replace("{source}", label)}
          </Dialog.Description>
          <div className="mt-5 flex gap-2 justify-end">
            <button
              onClick={onCancel}
              className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] text-text-mute hover:text-text-2 transition-colors"
            >
              {t("sections.inputs.reRunConfirm.actionCancel")}
            </button>
            <button
              onClick={onConfirm}
              className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
            >
              {t("sections.inputs.reRunConfirm.actionConfirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
