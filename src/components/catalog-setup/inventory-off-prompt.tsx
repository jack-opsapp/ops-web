"use client";

/**
 * InventoryOffPrompt — the one-time fork when stock-bearing items arrive but the
 * company isn't tracking inventory (spec §9, §16; plan Task 6.11). The owner
 * either turns tracking on (counts stay) or keeps the items as products (their
 * on-hand quantities are SURFACED on the product, never silently dropped).
 *
 * DESIGN JUDGMENT: this is a calm fork, not an alarm — so NO semantic border
 * color and NO accent (accent is the single BUILD IT CTA). The two choices are
 * neutral and equal-weight; the wizard doesn't push the owner toward either.
 *
 * Surface: the shared Dialog (already `.glass-dense`, radius/blur per DESIGN.md);
 * the Dialog owns its OPS entrance + reduced-motion fallback, so no bespoke
 * motion here. Voice: `//` UPPERCASE title (authority), sentence-case body
 * (content), count in JetBrains Mono tabular. Strings via useDictionary.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";

const MONO_NUM: React.CSSProperties = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

export interface InventoryOffPromptProps {
  open: boolean;
  /** How many stock-bearing items arrived (rendered in the body). */
  stockItemCount: number;
  /** Turn inventory tracking on — counts are kept. */
  onTrack: () => void;
  /** Keep the items as products — quantities surfaced, not dropped. */
  onKeepAsProducts: () => void;
  /** Radix open-change (esc / backdrop). The caller decides how to treat it. */
  onOpenChange?: (open: boolean) => void;
}

export function InventoryOffPrompt({
  open,
  stockItemCount,
  onTrack,
  onKeepAsProducts,
  onOpenChange,
}: InventoryOffPromptProps) {
  const { t } = useDictionary("catalog-setup");
  const noun =
    stockItemCount === 1
      ? t("inventoryOff.item", "stock item")
      : t("inventoryOff.items", "stock items");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]" data-testid="inventory-off-prompt">
        <DialogHeader>
          <DialogTitle className="font-cakemono text-cake-section font-light uppercase tracking-[0.02em] text-text">
            <span aria-hidden className="mr-1 font-mono text-data-sm text-text-mute">
              {"//"}
            </span>
            {t("inventoryOff.title", "Track inventory")}
          </DialogTitle>
          <DialogDescription className="font-mohave text-body-sm font-normal leading-relaxed text-text-2">
            {t("inventoryOff.lead", "You've added")}{" "}
            <span className="font-mono text-text" style={MONO_NUM}>
              {stockItemCount}
            </span>{" "}
            {noun}{" "}
            {t(
              "inventoryOff.tail",
              "without tracking inventory. Turn tracking on to keep counts — or keep them as products. Nothing's dropped either way.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onKeepAsProducts}
            data-testid="inventory-off-keep"
          >
            {t("inventoryOff.keep", "KEEP AS PRODUCTS")}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onTrack}
            data-testid="inventory-off-track"
          >
            {t("inventoryOff.track", "TRACK IT")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default InventoryOffPrompt;
