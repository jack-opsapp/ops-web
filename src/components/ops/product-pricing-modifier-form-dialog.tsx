"use client";

/**
 * Product Pricing Modifier Form Dialog — STUB.
 *
 * Phase 2 ships the route shell. Full create/edit/delete authoring lands
 * two commits later (Phase 4 — after the option authoring commit).
 */

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  ProductOption,
  ProductOptionValue,
  ProductPricingModifier,
} from "@/lib/types/product-options";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  productId: string;
  modifier?: ProductPricingModifier;
  options: ProductOption[];
  values: ProductOptionValue[];
  onClose: () => void;
}

export function ProductPricingModifierFormDialog({ open, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono font-light uppercase tracking-wider">
            {"// MODIFIER AUTHORING"}
          </DialogTitle>
        </DialogHeader>
        <p className="font-mohave text-body text-text-2 py-3">
          Authoring UI ships in a later commit.
        </p>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
