// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecP4InvoiceProps {
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  amountFormatted: string;
  invoiceNumber: string;
  dueDateFormatted: string;
  walkthroughDateFormatted: string;
  guaranteeEndsFormatted: string;
  stripeInvoiceUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecP4Invoice({
  buyerName,
  companyName,
  tier,
  amountFormatted,
  invoiceNumber,
  dueDateFormatted,
  walkthroughDateFormatted,
  guaranteeEndsFormatted,
  stripeInvoiceUrl,
  unsubscribeUrl,
  list,
}: SpecP4InvoiceProps) {
  return (
    <OpsEmailLayout
      preview={`P4 invoice — final milestone — ${amountFormatted}.`}
      eyebrow="// SPEC :: P4 INVOICE — FINAL"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>P4 invoice — delivery walkthrough complete.</Headline>
      <Paragraph>
        {buyerName}, walkthrough done for {companyName} SPEC {tier}. Modules
        are deployed to your OPS instance. Recording is on your engagement
        record. P4 of 4 — final Milestone — fires now.
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
        [30-DAY GUARANTEE REFUND]
      </Paragraph>
      <Paragraph small>
        The Guarantee Period clock started on the Walkthrough Date —{" "}
        {walkthroughDateFormatted}. The window closes{" "}
        {guaranteeEndsFormatted}. Within that window, you can request a refund
        by written notice stating dissatisfaction. No defect proof. No cure
        period. The guarantee can be invoked once per engagement.
      </Paragraph>
      <Paragraph small>
        After the window closes, build fees are non-refundable. Goodwill
        refunds are at OPS&apos;s discretion. Full mechanics in SPEC Terms of
        Service Section 9 and Section 22.
      </Paragraph>
      <Paragraph small>
        Your tier&apos;s Support Window is also live. File tickets through
        OPS-Web as usual — critical defects are no-charge per Section 10.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecP4Invoice.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  amountFormatted: "$2,125.00 CAD",
  invoiceNumber: "SPEC-2026-014-P4",
  dueDateFormatted: "Aug 14, 2026",
  walkthroughDateFormatted: "Jul 30, 2026",
  guaranteeEndsFormatted: "Aug 29, 2026",
  stripeInvoiceUrl: "https://invoice.stripe.com/i/preview",
} satisfies SpecP4InvoiceProps;

export default SpecP4Invoice;

export const previewProps = SpecP4Invoice.PreviewProps;
