// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecP3InvoiceProps {
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

export function SpecP3Invoice({
  buyerName,
  companyName,
  tier,
  amountFormatted,
  invoiceNumber,
  dueDateFormatted,
  stripeInvoiceUrl,
  unsubscribeUrl,
  list,
}: SpecP3InvoiceProps) {
  return (
    <OpsEmailLayout
      preview={`P3 invoice — ${amountFormatted} — due ${dueDateFormatted}.`}
      eyebrow="// SPEC :: P3 INVOICE"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>P3 invoice — midpoint accepted.</Headline>
      <Paragraph>
        {buyerName}, you accepted the midpoint deliverable for {companyName}{" "}
        SPEC {tier}. P3 of 4 invoice fires now per the Milestone schedule in
        the SPEC Terms of Service.
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
        [WHAT&apos;S LEFT]
      </Paragraph>
      <Paragraph small>
        Final-half build kicks off this week. Next event is the delivery
        walkthrough — once the remaining features deploy, you and the founder
        walk through everything live. Recording goes to your engagement
        record. P4 fires immediately after.
      </Paragraph>
      <Paragraph small>
        The 30-day Guarantee Refund clock will start at that walkthrough — not
        now.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecP3Invoice.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  amountFormatted: "$2,125.00 CAD",
  invoiceNumber: "SPEC-2026-014-P3",
  dueDateFormatted: "Jul 10, 2026",
  stripeInvoiceUrl: "https://invoice.stripe.com/i/preview",
} satisfies SpecP3InvoiceProps;

export default SpecP3Invoice;

export const previewProps = SpecP3Invoice.PreviewProps;
