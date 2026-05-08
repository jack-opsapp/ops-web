"use client";

/**
 * Product Option Form Dialog — STUB.
 *
 * Phase 2 ships the route shell. Full create/edit/delete/reorder
 * authoring lands in the next commit (Phase 3).
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
} from "@/lib/types/product-options";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  productId: string;
  option?: ProductOption;
  allOptions: ProductOption[];
  allValues: ProductOptionValue[];
  onClose: () => void;
}

export function ProductOptionFormDialog({ open, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono font-light uppercase tracking-wider">
            {"// OPTION AUTHORING"}
          </DialogTitle>
        </DialogHeader>
        <p className="font-mohave text-body text-text-2 py-3">
          Authoring UI ships in the next commit.
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
