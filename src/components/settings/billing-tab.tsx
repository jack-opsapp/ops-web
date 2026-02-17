"use client";

import { CreditCard, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function BillingTab() {
  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Payment Method</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="flex items-center gap-1.5 py-2">
            <CreditCard className="w-[24px] h-[24px] text-text-disabled" />
            <div>
              <p className="font-mohave text-body text-text-secondary">No payment method on file</p>
              <p className="font-kosugi text-[11px] text-text-disabled">
                Add a payment method to continue service after your trial ends.
              </p>
            </div>
          </div>
          <Button variant="secondary" className="gap-[6px]" onClick={() => toast.info("Payment setup coming soon", { description: "Contact support@opsapp.co for billing." })}>
            <CreditCard className="w-[14px] h-[14px]" />
            Add Payment Method
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-3">
            <FileText className="w-[32px] h-[32px] text-text-disabled mb-1" />
            <p className="font-mohave text-body text-text-tertiary">No billing history</p>
            <p className="font-kosugi text-[11px] text-text-disabled mt-0.5">
              Invoices will appear here after your first payment.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Download Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mohave text-body-sm text-text-secondary mb-1.5">
            Download past invoices for your records or accounting.
          </p>
          <Button variant="secondary" className="gap-[6px]" disabled>
            <Download className="w-[14px] h-[14px]" />
            Download All Invoices
          </Button>
          <p className="font-kosugi text-[11px] text-text-disabled mt-1">
            No invoices available to download.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
