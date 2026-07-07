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
import { Card, CardContent } from "@/components/ui/card";
import {
  RegisterTable,
  RegisterEmpty,
  TablePrimary,
  TableMeta,
  TableMono,
  Tag,
  type TagProps,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import {
  usePaymentMethods,
  useStripeInvoices,
  useCreateSetupIntent,
  useRemovePaymentMethod,
  useSetDefaultPaymentMethod,
  type PaymentMethod,
  type StripeInvoice,
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

// ─── Section header (canonical `// TITLE`) ──────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

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

function PaymentMethodCard({
  method,
  onRemove,
  isRemoving,
  onSetDefault,
  isSettingDefault,
}: {
  method: PaymentMethod;
  onRemove: (id: string) => void;
  isRemoving: boolean;
  onSetDefault: (id: string) => void;
  isSettingDefault: boolean;
}) {
  const { t } = useDictionary("settings");
  const brandDisplay = BRAND_KEYS[method.brand] ? t(BRAND_KEYS[method.brand]) : method.brand.charAt(0).toUpperCase() + method.brand.slice(1);
  return (
    <div className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0">
      <div className="flex items-center gap-1.5">
        <CreditCard className="w-[20px] h-[20px] text-text-2" />
        <div>
          <p className="font-mohave text-body text-text">
            {brandDisplay} {t("billing.endingIn")} {method.last4}
          </p>
          <p className="font-mono text-[11px] text-text-mute">
            {t("billing.expires")} {String(method.expMonth).padStart(2, "0")}/{method.expYear}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {method.isDefault ? (
          <Tag variant="neutral">{t("billing.defaultBadge")}</Tag>
        ) : (
          // Non-default cards get an explicit promote action. This is the
          // manual recovery path when a customer has cards on file but none
          // is the default — the exact state that blocks subscribe/recover.
          // Quiet secondary action: text ladder + hairline only, no accent
          // (the steel-blue accent is reserved for the screen's primary CTA).
          <button
            type="button"
            onClick={() => onSetDefault(method.id)}
            disabled={isSettingDefault}
            title={t("billing.setDefaultHint")}
            className="font-mono text-micro uppercase tracking-wider px-[6px] py-[2px] rounded-chip text-text-3 border border-white/10 hover:text-text hover:border-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSettingDefault ? (
              <Loader2 className="w-[12px] h-[12px] animate-spin inline" />
            ) : (
              t("billing.setDefault")
            )}
          </button>
        )}
        <button
          onClick={() => onRemove(method.id)}
          disabled={isRemoving}
          className="p-[4px] rounded-chip hover:bg-fill-neutral-dim transition-colors text-text-mute hover:text-rose"
          title={t("billing.removeCard")}
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
  const setDefaultPaymentMethod = useSetDefaultPaymentMethod();
  const { data: existingMethods } = usePaymentMethods();
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

      const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (error) {
        toast.error(error.message ?? t("billing.toast.addFailed"));
        return;
      }

      // Auto-promote the new card to default when the customer has none yet.
      // confirmCardSetup attaches the card but never sets the customer default,
      // and subscribe/recover require that default — so without this step the
      // first card a locked customer adds leaves them stuck at a 402.
      const newPaymentMethodId =
        typeof setupIntent?.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id ?? null;
      const hasExistingDefault = (existingMethods ?? []).some((m) => m.isDefault);

      if (newPaymentMethodId && !hasExistingDefault) {
        try {
          await setDefaultPaymentMethod.mutateAsync(newPaymentMethodId);
        } catch (defErr) {
          // The card is attached and saved — don't roll it back. Surface the
          // gap so the operator can finish with the card's "Set as default"
          // action rather than silently staying locked out.
          console.error("[AddCardForm] auto set-default failed:", defErr);
          toast.warning(t("billing.toast.added"), {
            description: t("billing.toast.addedNotDefaultDesc"),
          });
          onSuccess();
          return;
        }
      }

      toast.success(t("billing.toast.added"));
      onSuccess();
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
      <div className="bg-surface-input border border-border rounded p-1.5">
        <CardElement
          options={{
            // Stripe's CardElement renders inside an iframe and only accepts
            // literal CSS color strings — it cannot read our Tailwind tokens or
            // CSS variables. These hexes mirror the design tokens: #ededed = text,
            // #6b7280 ≈ text-3 placeholder, #ef4444 = rose error. (Acceptable
            // exception per the conformance pass — Stripe requires literal hex.)
            style: {
              base: {
                fontSize: "15px",
                color: "#ededed",
                "::placeholder": { color: "#6b7280" },
                backgroundColor: "transparent",
              },
              invalid: { color: "#ef4444" },
            },
          }}
        />
      </div>
      <div className="flex items-center gap-1">
        <Button type="submit" variant="primary" disabled={!stripe || submitting} className="gap-[6px]">
          {submitting ? (
            <Loader2 className="w-[14px] h-[14px] animate-spin" />
          ) : (
            <Check className="w-[14px] h-[14px]" />
          )}
          {t("billing.saveCard")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          {t("billing.cancel")}
        </Button>
      </div>
    </form>
  );
}

// ─── Invoice Status Badge ────────────────────────────────────────────────────

function InvoiceStatusBadge({ status }: { status: string | null }) {
  const { t } = useDictionary("settings");
  // Earth-tone semantics: paid=olive(positive), open=tan(attention),
  // draft/void=dim(inert), uncollectible=rose(negative).
  const variants: Record<string, TagProps["variant"]> = {
    paid: "olive",
    open: "tan",
    draft: "dim",
    void: "dim",
    uncollectible: "rose",
  };

  const s = status ?? "unknown";
  const variant = variants[s] ?? "dim";
  const statusLabels: Record<string, string> = {
    paid: t("billing.paid"),
    open: t("billing.open"),
    draft: t("billing.draft"),
    void: t("billing.void"),
    uncollectible: t("billing.uncollectible"),
  };

  return <Tag variant={variant}>{statusLabels[s] ?? s}</Tag>;
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
  const setDefaultMethod = useSetDefaultPaymentMethod();
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

  function handleSetDefault(paymentMethodId: string) {
    if (!can("settings.billing")) return;
    setDefaultMethod.mutate(paymentMethodId, {
      onSuccess: () =>
        toast.success(t("billing.toast.defaultSet"), {
          description: t("billing.toast.defaultSetDesc"),
        }),
      onError: (err) =>
        toast.error(t("billing.toast.defaultFailed"), {
          description: err instanceof Error ? err.message : t("billing.toast.unknownError"),
        }),
    });
  }

  const hasPaymentMethod = methods && methods.length > 0;

  const invoiceColumns: RegisterTableColumn<StripeInvoice>[] = [
    {
      id: "invoice",
      header: t("billing.invoiceColumn"),
      cell: (invoice) => (
        <div className="flex items-center gap-1.5">
          <FileText className="w-[16px] h-[16px] text-text-3 shrink-0" />
          <div className="min-w-0">
            <TablePrimary>{invoice.number ?? t("billing.invoiceFallback")}</TablePrimary>
            <TableMeta>
              {invoice.date
                ? new Date(invoice.date).toLocaleDateString(getDateLocale(locale), {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"}
            </TableMeta>
          </div>
        </div>
      ),
    },
    {
      id: "amount",
      header: t("billing.amountColumn"),
      align: "right",
      cell: (invoice) => <TableMono tone="default">${invoice.amount.toFixed(2)}</TableMono>,
    },
    {
      id: "status",
      header: t("billing.statusColumn"),
      align: "right",
      cell: (invoice) => <InvoiceStatusBadge status={invoice.status} />,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (invoice) => (
        <div className="flex items-center justify-end gap-1">
          {invoice.hostedUrl && (
            <a
              href={invoice.hostedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-[4px] rounded-chip hover:bg-fill-neutral-dim transition-colors"
            >
              <ExternalLink className="w-[14px] h-[14px] text-text-2" />
            </a>
          )}
          {invoice.pdfUrl && (
            <a
              href={invoice.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-[4px] rounded-chip hover:bg-fill-neutral-dim transition-colors"
            >
              <Download className="w-[14px] h-[14px] text-text-3" />
            </a>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Payment Method */}
      <Card>
        <div className="pb-2">
          <SectionLabel>{t("billing.paymentMethod")}</SectionLabel>
        </div>
        <CardContent>
          {methodsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-text-2 animate-spin" />
            </div>
          ) : hasPaymentMethod ? (
            <div className="space-y-0">
              {methods.map((method) => (
                <PaymentMethodCard
                  key={method.id}
                  method={method}
                  onRemove={handleRemoveCard}
                  isRemoving={removeMethod.isPending}
                  onSetDefault={handleSetDefault}
                  isSettingDefault={
                    setDefaultMethod.isPending &&
                    setDefaultMethod.variables === method.id
                  }
                />
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
                <CreditCard className="w-[24px] h-[24px] text-text-mute" />
                <div>
                  <p className="font-mohave text-body text-text-2">
                    {t("billing.noPaymentMethod")}
                  </p>
                  <p className="font-mono text-[11px] text-text-mute">
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
        <div className="pb-2">
          <SectionLabel>{t("billing.billingHistory")}</SectionLabel>
        </div>
        <CardContent>
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-text-2 animate-spin" />
            </div>
          ) : invoices && invoices.length > 0 ? (
            <RegisterTable
              columns={invoiceColumns}
              rows={invoices}
              getRowId={(invoice) => invoice.id}
              minWidth={360}
              ariaLabel={t("billing.billingHistory")}
              className="rounded-panel border border-border"
            />
          ) : (
            <RegisterEmpty
              noun={t("billing.billingHistory")}
              hint={t("billing.invoicesHelper")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
