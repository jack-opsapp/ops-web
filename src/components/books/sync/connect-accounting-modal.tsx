"use client";

/**
 * ConnectAccountingModal — the brief provider-choice flow behind the single
 * CONNECT entry point (WEB OVERHAUL P3-4). Same glass-dense primitive as the
 * settings modal, for consistency.
 *
 * Apple intent — we lead the choice: QuickBooks is pre-selected (the live
 * path); the operator confirms or switches. Sage is fully selectable (its
 * OAuth route exists) — never QB-only hardcoding. On CONNECT → provider OAuth
 * (the caller redirects the browser).
 */

import { useEffect, useState } from "react";
import { ArrowRight, Calculator } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { AccountingProvider } from "@/lib/types/pipeline";

const PROVIDERS: { value: AccountingProvider; nameKey: string; descKey: string; shortKey: string }[] =
  [
    {
      value: AccountingProvider.QuickBooks,
      nameKey: "integrations.quickbooks",
      descKey: "integrations.quickbooksDesc",
      shortKey: "sync.provider.quickbooks",
    },
    {
      value: AccountingProvider.Sage,
      nameKey: "integrations.sage",
      descKey: "integrations.sageDesc",
      shortKey: "sync.provider.sage",
    },
  ];

export function ConnectAccountingModal({
  open,
  onClose,
  onConnect,
  connecting = false,
}: {
  open: boolean;
  onClose: () => void;
  onConnect: (provider: AccountingProvider) => void;
  connecting?: boolean;
}) {
  const { t } = useDictionary("books");
  const { t: ta } = useDictionary("accounting");
  const [selected, setSelected] = useState<AccountingProvider>(AccountingProvider.QuickBooks);

  // We lead the choice — QuickBooks is pre-selected on every open (Apple intent),
  // not the operator's last (abandoned) pick.
  useEffect(() => {
    if (open) setSelected(AccountingProvider.QuickBooks);
  }, [open]);

  const selectedShortKey =
    PROVIDERS.find((p) => p.value === selected)?.shortKey ?? "sync.provider.quickbooks";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("sync.picker.title")}
          </DialogTitle>
        </DialogHeader>

        <p className="mb-4 font-mono text-caption-sm text-text-3">[ {t("sync.picker.subtitle")} ]</p>

        <div className="space-y-2">
          {PROVIDERS.map((p) => {
            const isSel = p.value === selected;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setSelected(p.value)}
                aria-pressed={isSel}
                className={cn(
                  "flex w-full items-center gap-3 rounded-panel border p-3 text-left",
                  "transition-colors duration-150 ease-smooth",
                  isSel
                    ? "border-line-hi bg-surface-active"
                    : "border-border hover:bg-surface-hover",
                )}
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-sidebar bg-fill-neutral-dim text-text-2">
                  <Calculator className="h-[20px] w-[20px]" />
                </span>
                <span className="flex-1">
                  <span className="block font-mohave text-body-sm font-medium text-text">
                    {ta(p.nameKey)}
                  </span>
                  <span className="mt-[1px] block font-mohave text-body-sm leading-snug text-text-3">
                    {ta(p.descKey)}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border",
                    isSel ? "border-text" : "border-text-3",
                  )}
                >
                  {isSel && <span className="h-[8px] w-[8px] rounded-full bg-text" />}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-3.5 font-mono text-caption-sm leading-relaxed text-text-3">
          [ {t("sync.picker.reassurance")} ]
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("sync.picker.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => onConnect(selected)}
            loading={connecting}
            className="gap-1.5"
          >
            {t("sync.picker.connect", { provider: t(selectedShortKey) })}
            <ArrowRight className="h-[15px] w-[15px]" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
