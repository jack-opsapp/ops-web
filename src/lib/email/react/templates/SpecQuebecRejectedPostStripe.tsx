// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecQuebecRejectedPostStripeProps {
  buyerName: string;
  amountRefundedFormatted: string;
  refundedAtFormatted: string;
  stripeRefundReceiptUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecQuebecRejectedPostStripe({
  buyerName,
  amountRefundedFormatted,
  refundedAtFormatted,
  stripeRefundReceiptUrl,
  unsubscribeUrl,
  list,
}: SpecQuebecRejectedPostStripeProps) {
  return (
    <OpsEmailLayout
      preview="Quebec billing detected. Full refund issued. Purchase cancelled."
      eyebrow="// SPEC :: CANCELLED — FULL REFUND ISSUED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Purchase cancelled. Full refund issued.</Headline>
      <Paragraph>
        {buyerName}, your billing address came through as Quebec at the
        checkout step. SPEC is not available in Quebec — and the eligibility
        form before checkout asked you to confirm that.
      </Paragraph>
      <Paragraph>
        We&apos;ve refunded the full deposit and cancelled the engagement.
        There is nothing for you to do.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Refund amount">{amountRefundedFormatted}</InfoBlock>
      <InfoBlock label="Refund issued">{refundedAtFormatted}</InfoBlock>
      <InfoBlock label="Stripe receipt">
        <a href={stripeRefundReceiptUrl} style={{ color: "rgba(10,10,10,0.84)", textDecoration: "underline" }}>view refund record</a>
      </InfoBlock>
      <Spacer size="md" />
      <Paragraph>
        Funds typically land in your account within 5 to 10 business days,
        depending on your card issuer.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [WHY THIS HAPPENED]
      </Paragraph>
      <Paragraph small>
        The SPEC Terms of Service exclude Quebec. The exclusion exists because
        of Quebec&apos;s Consumer Protection Act, French-language commercial
        requirements, and Law 25 privacy rules. We don&apos;t have the
        infrastructure to serve those obligations correctly at launch.
      </Paragraph>
      <Paragraph small>
        Per Section 4 of the SPEC Terms of Service, misrepresenting Quebec
        eligibility on the pre-payment form is a material breach. Your account
        has been added to the SPEC blocked-buyer list. Future SPEC purchase
        attempts will not be processed.
      </Paragraph>
      <Paragraph small>
        Your base OPS subscription is unaffected. This action only applies to
        SPEC engagements.
      </Paragraph>
      <Paragraph small>
        If you believe this is in error — for example, your billing address is
        outside Quebec and Stripe got it wrong — reply to this email with the
        correct address documentation.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecQuebecRejectedPostStripe.PreviewProps = {
  buyerName: "Sam Reyes",
  amountRefundedFormatted: "$2,125.00 CAD",
  refundedAtFormatted: "May 26, 2026 at 2:18 PM PDT",
  stripeRefundReceiptUrl: "https://pay.stripe.com/receipts/preview-refund",
} satisfies SpecQuebecRejectedPostStripeProps;

export default SpecQuebecRejectedPostStripe;

export const previewProps = SpecQuebecRejectedPostStripe.PreviewProps;
