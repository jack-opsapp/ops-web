"use client";

import { useEffect, useState } from "react";
import { FileText, Upload } from "lucide-react";

import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDictionary } from "@/i18n/client";
import type { SupplierDocumentKind } from "@/lib/accounting/supplier-bills/intake-contracts";
import { useCaptureSupplierBillIntake } from "@/lib/hooks/use-supplier-bill-intakes";

export function SupplierBillCaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useDictionary("books");
  const capture = useCaptureSupplierBillIntake();
  const resetCapture = capture.reset;
  const [documentKind, setDocumentKind] =
    useState<SupplierDocumentKind>("material");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) {
      setDocumentKind("material");
      setFile(null);
      resetCapture();
    }
  }, [open, resetCapture]);

  const submit = async () => {
    if (!file) return;
    try {
      const result = await capture.mutateAsync({ file, documentKind });
      toast.success(
        t("bills.capture.success", {
          invoice: result.intake.invoice_number,
        })
      );
      onOpenChange(false);
    } catch {
      toast.error(t("bills.capture.failed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("bills.capture.title")}</DialogTitle>
          <DialogDescription>{t("bills.capture.body")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="space-y-0.5">
            <label className="font-mohave text-caption-sm uppercase tracking-wide text-text-3">
              {t("bills.capture.kind")}
            </label>
            <Select
              value={documentKind}
              onValueChange={(value) =>
                setDocumentKind(value as SupplierDocumentKind)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="material">
                  {t("bills.kind.material")}
                </SelectItem>
                <SelectItem value="subcontractor">
                  {t("bills.kind.subcontractor")}
                </SelectItem>
                <SelectItem value="employee">
                  {t("bills.kind.employee")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded border border-dashed border-line-hi bg-surface-input px-2 py-1.5 transition-colors focus-within:ring-1 focus-within:ring-ops-accent hover:bg-surface-hover">
            {file ? (
              <FileText className="h-icon-20 w-icon-20 shrink-0 text-ops-accent" />
            ) : (
              <Upload className="h-icon-20 w-icon-20 shrink-0 text-text-3" />
            )}
            <span className="min-w-0 font-mohave text-body text-text-2">
              {file?.name ?? t("bills.capture.choose")}
            </span>
            <input
              className="sr-only"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <p className="font-mono text-caption-sm uppercase tracking-wider text-text-3">
            {t("bills.capture.note")}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("bills.action.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!file}
            loading={capture.isPending}
            onClick={() => void submit()}
          >
            {t("bills.capture.cta")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
