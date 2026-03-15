"use client";

import { useState, useCallback } from "react";
import {
  CreditCard,
  Download,
  FileText,
  ExternalLink,
  Loader2,
  Plus,
  Check,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  usePaymentMethods,
  useStripeInvoices,
  useCreateSetupIntent,
  useRemovePaymentMethod,
  type PaymentMethod,
} from "@/lib/hooks/use-billing";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary, useLocale } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { getDateLocale } from "@/i18n/date-utils";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

// Lazy-load Stripe.js
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

// ─── Card Brand Display ──────────────────────────────────────────────────────

const BRAND_KEYS: Record<string, string> = {
  visa: "billing.visa",
  mastercard: "billing.mastercard",
  amex: "billing.amex",
  discover: "billing.discover",
  diners: "billing.diners",
  jcb: "billing.jcb",
  unionpay: "billing.unionpay",
};

// ─── Payment Method Card ─────────────────────────────────────────────────────

function PaymentMethodCard({ method, onRemove, isRemoving }: { method: PaymentMethod; onRemove: (id: string) => void; isRemoving: boolean }) {
  const { t } = useDictionary("settings");
  const brandDisplay = BRAND_KEYS[method.brand] ? t(BRAND_KEYS[method.brand]) : method.brand.charAt(0).toUpperCase() + method.brand.slice(1);
  return (
    <div className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0">
      <div className="flex items-center gap-1.5">
        <CreditCard className="w-[20px] h-[20px] text-text-secondary" />
        <div>
          <p className="font-mohave text-body text-text-primary">
            {brandDisplay} {t("billing.endingIn")} {method.last4}
          </p>
          <p className="font-kosugi text-[11px] text-text-disabled">
            {t("billing.expires")} {String(method.expMonth).padStart(2, "0")}/{method.expYear}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {method.isDefault && (
          <span className="font-kosugi text-[9px] text-ops-accent bg-ops-accent-muted px-[6px] py-[2px] rounded-full uppercase tracking-wider">
            {t("billing.defaultBadge")}
          </span>
        )}
        <button
          onClick={() => onRemove(method.id)}
          disabled={isRemoving}
          className="p-[4px] rounded hover:bg-background-elevated transition-colors text-text-disabled hover:text-red-400"
          title="Remove card"
        >
          {isRemoving ? (
            <Loader2 className="w-[14px] h-[14px] animate-spin" />
          ) : (
            <Trash2 className="w-[14px] h-[14px]" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Add Card Form (inside Elements provider) ────────────────────────────────

function AddCardForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const stripe = useStripe();
  const elements = useElements();
  const createSetupIntent = useCreateSetupIntent();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!can("settings.billing")) return;
    if (!stripe || !elements) return;

    setSubmitting(true);
    try {
      // Create SetupIntent
      const { clientSecret } = await createSetupIntent.mutateAsync();

      // Confirm card setup
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");

      const { error } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (error) {
        toast.error(error.message ?? t("billing.toast.addFailed"));
      } else {
        toast.success(t("billing.toast.added"));
        onSuccess();
      }
    } catch (err) {
      toast.error(t("billing.toast.addFailed"), {
        description: err instanceof Error ? err.message : t("billing.toast.unknownError"),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="bg-background-input border border-border rounded-lg p-1.5">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "15px",
                color: "#e5e5e5",
                "::placeholder": { color: "#6b7280" },
                backgroundColor: "transparent",
              },
              invalid: { color: "#ef4444" },
            },
          }}
        />
      </div>
      <div className="flex items-center gap-1">
        <Button type="submit" disabled={!stripe || submitting} className="gap-[6px]">
          {submitting ? (
            <Loader2 className="w-[14px] h-[14px] animate-spin" />
          ) : (
            <Check className="w-[14px] h-[14px]" />
          )}
          {t("billing.saveCard")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Invoice Status Badge ────────────────────────────────────────────────────

function InvoiceStatusBadge({ status }: { status: string | null }) {
  const { t } = useDictionary("settings");
  const styles: Record<string, string> = {
    paid: "text-status-success bg-status-success/10",
    open: "text-ops-amber bg-ops-amber/10",
    draft: "text-text-disabled bg-background-elevated",
    void: "text-text-disabled bg-background-elevated",
    uncollectible: "text-ops-error bg-ops-error-muted",
  };

  const s = status ?? "unknown";
  const className = styles[s] ?? "text-text-disabled bg-background-elevated";
  const statusLabels: Record<string, string> = {
    paid: t("billing.paid"),
    open: t("billing.open"),
    draft: t("billing.draft"),
    void: t("billing.void"),
    uncollectible: t("billing.uncollectible"),
  };

  return (
    <span className={`font-kosugi text-[9px] uppercase tracking-wider px-[6px] py-[2px] rounded-full ${className}`}>
      {statusLabels[s] ?? s}
    </span>
  );
}

// ─── Main Billing Tab ────────────────────────────────────────────────────────

export function BillingTab() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { locale } = useLocale();
  const { company } = useAuthStore();
  const { data: methods, isLoading: methodsLoading, refetch: refetchMethods } = usePaymentMethods();
  const { data: invoices, isLoading: invoicesLoading } = useStripeInvoices();
  const removeMethod = useRemovePaymentMethod();
  const [showAddCard, setShowAddCard] = useState(false);

  const handleCardAdded = useCallback(() => {
    setShowAddCard(false);
    refetchMethods();
  }, [refetchMethods]);

  function handleRemoveCard(paymentMethodId: string) {
    if (!can("settings.billing")) return;
    removeMethod.mutate(paymentMethodId, {
      onSuccess: () => toast.success(t("billing.toast.removed") ?? "Payment method removed"),
      onError: (err) => toast.error(t("billing.toast.removeFailed") ?? "Failed to remove", { description: err.message }),
    });
  }

  const hasPaymentMethod = methods && methods.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>{t("billing.paymentMethod")}</CardTitle>
        </CardHeader>
        <CardContent>
          {methodsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : hasPaymentMethod ? (
            <div className="space-y-0">
              {methods.map((method) => (
                <PaymentMethodCard key={method.id} method={method} onRemove={handleRemoveCard} isRemoving={removeMethod.isPending} />
              ))}
              {!showAddCard && (
                <Button
                  variant="secondary"
                  className="gap-[6px] mt-1.5"
                  onClick={() => setShowAddCard(true)}
                >
                  <Plus className="w-[14px] h-[14px]" />
                  {t("billing.addAnotherCard")}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 py-2">
                <CreditCard className="w-[24px] h-[24px] text-text-disabled" />
                <div>
                  <p className="font-mohave text-body text-text-secondary">
                    {t("billing.noPaymentMethod")}
                  </p>
                  <p className="font-kosugi text-[11px] text-text-disabled">
                    {t("billing.addPaymentHelper")}
                  </p>
                </div>
              </div>
              {!showAddCard && (
                <Button
                  variant="secondary"
                  className="gap-[6px]"
                  onClick={() => setShowAddCard(true)}
                >
                  <CreditCard className="w-[14px] h-[14px]" />
                  {t("billing.addPaymentMethod")}
                </Button>
              )}
            </div>
          )}

          {showAddCard && company && (
            <div className="mt-1.5 pt-1.5 border-t border-[rgba(255,255,255,0.04)]">
              <Elements stripe={stripePromise}>
                <AddCardForm
                  onSuccess={handleCardAdded}
                  onCancel={() => setShowAddCard(false)}
                />
              </Elements>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing History */}
      <Card>
        <CardHeader>
          <CardTitle>{t("billing.billingHistory")}</CardTitle>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : invoices && invoices.length > 0 ? (
            <div className="space-y-0">
              {invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
                >
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-[16px] h-[16px] text-text-tertiary shrink-0" />
                    <div>
                      <p className="font-mohave text-body-sm text-text-primary">
                        {invoice.number ?? "Invoice"}
                      </p>
                      <p className="font-kosugi text-[10px] text-text-disabled">
                        {invoice.date
                          ? new Date(invoice.date).toLocaleDateString(getDateLocale(locale), {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-body-sm text-text-primary">
                      ${invoice.amount.toFixed(2)}
                    </span>
                    <InvoiceStatusBadge status={invoice.status} />
                    {invoice.hostedUrl && (
                      <a
                        href={invoice.hostedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-[4px] rounded hover:bg-background-elevated transition-colors"
                      >
                        <ExternalLink className="w-[14px] h-[14px] text-ops-accent" />
                      </a>
                    )}
                    {invoice.pdfUrl && (
                      <a
                        href={invoice.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-[4px] rounded hover:bg-background-elevated transition-colors"
                      >
                        <Download className="w-[14px] h-[14px] text-text-tertiary" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-3">
              <FileText className="w-[32px] h-[32px] text-text-disabled mb-1" />
              <p className="font-mohave text-body text-text-tertiary">{t("billing.noBillingHistory")}</p>
              <p className="font-kosugi text-[11px] text-text-disabled mt-0.5">
                {t("billing.invoicesHelper")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
