"use client";

/**
 * Record-payment modal — ported verbatim from the retired
 * (dashboard)/invoices page for the Books invoices segment (P3.1).
 * Inserts into `payments`; DB triggers own amount_paid / balance_due / status.
 */

import { useState, useEffect } from "react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, PaymentMethod } from "@/lib/types/pipeline";
import type { Invoice, CreatePayment } from "@/lib/types/pipeline";

const paymentMethodLabels: Record<PaymentMethod, string> = {
  [PaymentMethod.Cash]: "Cash",
  [PaymentMethod.Check]: "Check",
  [PaymentMethod.CreditCard]: "Credit Card",
  [PaymentMethod.DebitCard]: "Debit Card",
  [PaymentMethod.Ach]: "ACH",
  [PaymentMethod.BankTransfer]: "Bank Transfer",
  [PaymentMethod.Stripe]: "Stripe",
  [PaymentMethod.Other]: "Other",
};

export function RecordPaymentModal({
  open,
  onClose,
  invoice,
  companyId,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  companyId: string;
  onSubmit: (data: CreatePayment) => void;
}) {
  const { t } = useDictionary("pipeline");
  const [amount, setAmount] = useState(invoice?.balanceDue ?? 0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.Other);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (invoice) {
      setAmount(invoice.balanceDue);
      setDate(new Date().toISOString().slice(0, 10));
      setMethod(PaymentMethod.Other);
      setReferenceNumber("");
      setNotes("");
    }
  }, [invoice]);

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            {t("invoices.payment.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          <div className="bg-fill-neutral-dim rounded p-1.5 space-y-0.5">
            <div className="flex justify-between">
              <span className="font-mono text-caption text-text-3">{t("invoices.payment.invoice")}</span>
              <span className="font-mono text-data text-text">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-caption text-text-3">{t("invoices.payment.total")}</span>
              <span className="font-mono text-data text-text">{formatCurrency(invoice.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-caption text-text-3">{t("invoices.payment.balanceDue")}</span>
              <span className="font-mono text-data text-ops-error">{formatCurrency(invoice.balanceDue)}</span>
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">{t("invoices.payment.amount")}</label>
            <div className="flex gap-1">
              <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} className="flex-1" />
              <Button variant="secondary" size="sm" onClick={() => setAmount(invoice.balanceDue)}>{t("invoices.payment.payInFull")}</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">{t("invoices.payment.date")}</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">{t("invoices.payment.method")}</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text">
                {Object.entries(paymentMethodLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">{t("invoices.payment.reference")}</label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Check #, transaction ID..." />
          </div>

          <div className="space-y-0.5">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">{t("invoices.payment.notes")}</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("invoices.payment.notes")} rows={2} />
          </div>

          <div className="flex justify-end gap-1 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => {
                onSubmit({
                  invoiceId: invoice.id,
                  companyId,
                  clientId: invoice.clientId,
                  amount,
                  paymentDate: new Date(date),
                  paymentMethod: method,
                  referenceNumber: referenceNumber || null,
                  notes: notes || null,
                  stripePaymentIntent: null,
                  createdBy: null,
                });
              }}
              disabled={amount <= 0}
            >
              {t("invoices.payment.title")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
