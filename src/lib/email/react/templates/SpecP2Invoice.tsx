// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecP2InvoiceProps {
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  amountFormatted: string;
  invoiceNumber: string;
  dueDateFormatted: string;
  stripeInvoiceUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecP2Invoice({
  buyerName,
  companyName,
  tier,
  amountFormatted,
  invoiceNumber,
  dueDateFormatted,
  stripeInvoiceUrl,
  unsubscribeUrl,
  list,
}: SpecP2InvoiceProps) {
  return (
    <OpsEmailLayout
      preview={`P2 invoice — ${amountFormatted} — due ${dueDateFormatted}.`}
      eyebrow="// SPEC :: P2 INVOICE"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>P2 invoice — scope sign-off.</Headline>
      <Paragraph>
        {buyerName}, scope signed for {companyName} SPEC {tier}. P2 of 4
        invoice fires now per the Milestone schedule in the SPEC Terms of
        Service.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Invoice">#{invoiceNumber}</InfoBlock>
      <InfoBlock label="Amount">{amountFormatted}</InfoBlock>
      <InfoBlock label="Due">{dueDateFormatted}</InfoBlock>
      <InfoBlock label="Terms">Net-15</InfoBlock>
      <Spacer size="md" />
      <Button href={stripeInvoiceUrl}>Pay invoice &rarr;</Button>
      <Divider />
      <Paragraph small>
        [PAYMENT TERMS]
      </Paragraph>
      <Paragraph small>
        Net-15. If payment slips more than 7 days past the due date, OPS may
        disable the in-progress Custom Modules until the invoice clears, per
        SPEC Terms of Service Section 6. The Guarantee Period clock is tolled
        during any non-payment disablement.
      </Paragraph>
      <Paragraph small>
        Stripe Tax handled GST/HST/PST at checkout based on your billing
        address. The Stripe invoice page has the full tax breakdown.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecP2Invoice.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  amountFormatted: "$2,125.00 CAD",
  invoiceNumber: "SPEC-2026-014-P2",
  dueDateFormatted: "Jun 14, 2026",
  stripeInvoiceUrl: "https://invoice.stripe.com/i/preview",
} satisfies SpecP2InvoiceProps;

export default SpecP2Invoice;

export const previewProps = SpecP2Invoice.PreviewProps;
