"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/types/pipeline";
import { CreditCard, Loader2, CheckCircle, AlertCircle, X } from "lucide-react";

interface PortalPaymentFormProps {
  invoiceId: string;
  balanceDue: number;
  onSuccess: () => void;
  onCancel: () => void;
}

interface PaymentResponse {
  clientSecret: string;
  paymentId?: string;
}

export function PortalPaymentForm({
  invoiceId,
  balanceDue,
  onSuccess,
  onCancel,
}: PortalPaymentFormProps) {
  const [amount, setAmount] = useState(balanceDue.toFixed(2));
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount) || 0;
  const isValidAmount = parsedAmount > 0 && parsedAmount <= balanceDue;

  const payMutation = useMutation<PaymentResponse, Error, { amount: number }>({
    mutationFn: async ({ amount: payAmount }) => {
      const res = await fetch(`/api/portal/invoices/${invoiceId}/pay`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: payAmount }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Payment failed. Please try again.");
      }
      return res.json();
    },
    onSuccess: () => {
      setPaymentSuccess(true);
      setPaymentError(null);
      // Allow the user to see the success state before closing
      setTimeout(() => {
        onSuccess();
      }, 2000);
    },
    onError: (err) => {
      setPaymentError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidAmount || payMutation.isPending) return;
    setPaymentError(null);
    payMutation.mutate({ amount: parsedAmount });
  }

  // Success state
  if (paymentSuccess) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
          borderRadius: "var(--portal-radius-lg)",
        }}
      >
        <CheckCircle
          className="w-12 h-12 mx-auto mb-4"
          style={{ color: "var(--portal-success)" }}
        />
        <h3
          className="text-lg mb-2"
          style={{
            fontFamily: "var(--portal-heading-font)",
            fontWeight: "var(--portal-heading-weight)",
          }}
        >
          Payment Successful
        </h3>
        <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>
          Your payment of {formatCurrency(parsedAmount)} has been processed.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: "var(--portal-card)",
        border: "1px solid var(--portal-border)",
        borderRadius: "var(--portal-radius-lg)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid var(--portal-border)" }}
      >
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5" style={{ color: "var(--portal-accent)" }} />
          <h3
            className="text-base font-semibold"
            style={{
              fontFamily: "var(--portal-heading-font)",
              fontWeight: "var(--portal-heading-weight)",
            }}
          >
            Make a Payment
          </h3>
        </div>
        <button
          onClick={onCancel}
          className="p-1 rounded transition-colors"
          style={{ color: "var(--portal-text-tertiary)" }}
          aria-label="Close payment form"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {/* Balance info */}
        <div
          className="flex items-center justify-between p-4 rounded-lg"
          style={{
            backgroundColor: "var(--portal-bg-secondary)",
            borderRadius: "var(--portal-radius)",
          }}
        >
          <span className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>
            Balance Due
          </span>
          <span className="text-lg font-bold" style={{ color: "var(--portal-warning)" }}>
            {formatCurrency(balanceDue)}
          </span>
        </div>

        {/* Amount input */}
        <div>
          <label
            htmlFor="payment-amount"
            className="block text-sm font-medium mb-2"
            style={{ color: "var(--portal-text-secondary)" }}
          >
            Payment Amount
          </label>
          <div className="relative">
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: "var(--portal-text-tertiary)" }}
            >
              $
            </span>
            <input
              id="payment-amount"
              type="number"
              step="0.01"
              min="0.01"
              max={balanceDue}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={payMutation.isPending}
              className="w-full pl-7 pr-4 py-3 text-sm rounded-lg outline-none transition-colors"
              style={{
                backgroundColor: "var(--portal-bg-secondary)",
                border: "1px solid var(--portal-border)",
                borderRadius: "var(--portal-radius)",
                color: "var(--portal-text)",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--portal-accent)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--portal-border)";
              }}
            />
          </div>
          {parsedAmount > balanceDue && (
            <p className="text-xs mt-1" style={{ color: "var(--portal-error)" }}>
              Amount cannot exceed the balance due of {formatCurrency(balanceDue)}
            </p>
          )}
          {parsedAmount > 0 && parsedAmount < balanceDue && (
            <p className="text-xs mt-1" style={{ color: "var(--portal-text-tertiary)" }}>
              Partial payment: {formatCurrency(balanceDue - parsedAmount)} will remain
            </p>
          )}
        </div>

        {/* Stripe Elements integration pending — disable payment to prevent
            orphaned PaymentIntents and misleading success messages. */}
        <div
          className="p-6 rounded-lg text-center"
          style={{
            backgroundColor: "var(--portal-bg-secondary)",
            border: "1px dashed var(--portal-border)",
            borderRadius: "var(--portal-radius)",
          }}
        >
          <CreditCard
            className="w-8 h-8 mx-auto mb-2"
            style={{ color: "var(--portal-text-tertiary)" }}
          />
          <p className="text-sm font-medium mb-1" style={{ color: "var(--portal-text-secondary)" }}>
            Online payments coming soon
          </p>
          <p className="text-xs" style={{ color: "var(--portal-text-tertiary)" }}>
            Contact your service provider for payment instructions.
          </p>
        </div>

        {/* Error state */}
        {paymentError && (
          <div
            className="flex items-start gap-2 p-3 rounded-lg text-sm"
            style={{
              backgroundColor: "rgba(147,50,26,0.1)",
              border: "1px solid var(--portal-error)",
              borderRadius: "var(--portal-radius)",
              color: "var(--portal-error)",
            }}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{paymentError}</span>
          </div>
        )}

        {/* Submit button — disabled until Stripe Elements integration */}
        <button
          type="button"
          disabled
          className="w-full py-3 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          style={{
            backgroundColor: "var(--portal-bg-secondary)",
            color: "var(--portal-text-tertiary)",
            borderRadius: "var(--portal-radius)",
            cursor: "not-allowed",
          }}
        >
          Pay {isValidAmount ? formatCurrency(parsedAmount) : ""}
        </button>
      </form>
    </div>
  );
}
