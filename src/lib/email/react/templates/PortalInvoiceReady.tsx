// @template-version: 1.0.0
import * as React from "react";
import { PortalEmailLayout } from "../layouts/PortalEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";

interface PortalInvoiceReadyProps {
  companyName: string;
  invoiceNumber: string;
  amount: string;
  portalUrl: string;
  accentColor: string;
  logoUrl: string | null;
  unsubscribeUrl?: string;
  list?: string;
  companyPhysicalAddress?: string | null;
}

export function PortalInvoiceReady({
  companyName,
  invoiceNumber,
  amount,
  portalUrl,
  accentColor,
  logoUrl,
  unsubscribeUrl,
  list,
  companyPhysicalAddress,
}: PortalInvoiceReadyProps) {
  return (
    <PortalEmailLayout
      preview={`Invoice ${invoiceNumber} — ${amount}`}
      eyebrow={`Invoice ${invoiceNumber}`}
      companyName={companyName}
      companyPhysicalAddress={companyPhysicalAddress}
      logoUrl={logoUrl}
      accentColor={accentColor}
      senderAddress="noreply@opsapp.co"
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Your invoice from {companyName}.</Headline>
      <Paragraph>Job&apos;s done. Tap below to review and pay.</Paragraph>
      <InfoBlock label="Invoice">#{invoiceNumber}</InfoBlock>
      <InfoBlock label="Amount">{amount}</InfoBlock>
      <Spacer size="md" />
      <Button href={portalUrl} accentColor={accentColor}>
        Pay invoice &rarr;
      </Button>
    </PortalEmailLayout>
  );
}

PortalInvoiceReady.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  invoiceNumber: "2026-014",
  amount: "$4,820.00",
  portalUrl: "https://app.opsapp.co/portal/preview",
  accentColor: "#597794",
  logoUrl: null,
} satisfies PortalInvoiceReadyProps;

export default PortalInvoiceReady;

export const previewProps = PortalInvoiceReady.PreviewProps;
