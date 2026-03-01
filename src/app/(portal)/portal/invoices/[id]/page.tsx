"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useDictionary } from "@/i18n/client";
import { PortalInvoiceView } from "@/components/portal/portal-invoice-view";
import { PortalPaymentForm } from "@/components/portal/portal-payment-form";
import { usePortalData } from "@/lib/hooks/use-portal-data";
import { getFieldVisibility } from "@/lib/portal/resolve-template-branding";
import type { DocumentTemplate } from "@/lib/types/document-template";
import type { DocumentPartyInfo } from "@/components/portal/portal-invoice-view";

interface InvoiceLineItem {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface InvoicePayment {
  id: string;
  amount: number;
  paymentMethod: string | null;
  paymentDate: string;
  referenceNumber: string | null;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  subject: string | null;
  status: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  clientMessage: string | null;
  footer: string | null;
  lineItems: InvoiceLineItem[];
  payments: InvoicePayment[];
  projectId: string | null;
  template: DocumentTemplate | null;
}

export default function InvoiceDetailPage() {
  const { t } = useDictionary("portal");
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  const { data: portalData } = usePortalData();

  const { data: invoice, isLoading, error } = useQuery<InvoiceDetail>({
    queryKey: ["portal", "invoice", id],
    queryFn: async () => {
      const res = await fetch(`/api/portal/invoices/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load invoice");
      return res.json();
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: "var(--portal-accent)" }}
        />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "var(--portal-text-secondary)" }}>
          {t("invoice.loadError")}
        </p>
        <Link
          href="/portal/home"
          className="inline-flex items-center gap-1 mt-4 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          {t("invoice.backHome")}
        </Link>
      </div>
    );
  }

  function handlePaymentSuccess() {
    setShowPaymentForm(false);
    queryClient.invalidateQueries({ queryKey: ["portal", "invoice", id] });
    queryClient.invalidateQueries({ queryKey: ["portal", "data"] });
  }

  // Build company/client info for From/To sections
  const companyInfo: DocumentPartyInfo | null = portalData?.company
    ? {
        name: portalData.company.name,
        phone: portalData.company.phone,
        email: portalData.company.email,
      }
    : null;

  const clientInfo: DocumentPartyInfo | null = portalData?.client
    ? {
        name: portalData.client.name,
        email: portalData.client.email,
        phone: portalData.client.phoneNumber,
        address: portalData.client.address,
      }
    : null;

  const fieldVisibility = getFieldVisibility(invoice.template);

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Link
        href="/portal/home"
        className="inline-flex items-center gap-1 text-sm transition-colors"
        style={{ color: "var(--portal-text-secondary)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        {t("invoice.back")}
      </Link>

      {/* Invoice content */}
      <PortalInvoiceView
        invoice={invoice}
        fieldVisibility={fieldVisibility}
        companyInfo={companyInfo}
        clientInfo={clientInfo}
      />

      {/* Pay Now button */}
      {invoice.balanceDue > 0 && !showPaymentForm && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setShowPaymentForm(true)}
            className="px-8 py-3 rounded-lg text-sm font-semibold transition-colors"
            style={{
              backgroundColor: "var(--portal-accent)",
              color: "var(--portal-accent-text)",
              borderRadius: "var(--portal-radius)",
            }}
          >
            {t("invoice.payNow")}
          </button>
        </div>
      )}

      {/* Payment form */}
      {showPaymentForm && (
        <PortalPaymentForm
          invoiceId={invoice.id}
          balanceDue={invoice.balanceDue}
          onSuccess={handlePaymentSuccess}
          onCancel={() => setShowPaymentForm(false)}
        />
      )}
    </div>
  );
}
