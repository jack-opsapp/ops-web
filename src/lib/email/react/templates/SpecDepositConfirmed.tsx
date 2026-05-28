// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecDepositConfirmedProps {
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  depositAmountFormatted: string;
  totalAmountFormatted: string;
  paidAtFormatted: string;
  stripeReceiptUrl: string;
  intakeUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecDepositConfirmed({
  buyerName,
  companyName,
  tier,
  depositAmountFormatted,
  totalAmountFormatted,
  paidAtFormatted,
  stripeReceiptUrl,
  intakeUrl,
  unsubscribeUrl,
  list,
}: SpecDepositConfirmedProps) {
  return (
    <OpsEmailLayout
      preview={`Deposit received. SPEC ${tier} for ${companyName} is live.`}
      eyebrow="// SPEC :: DEPOSIT RECEIVED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{buyerName}, you&apos;re in. Let&apos;s build.</Headline>
      <Paragraph>
        Deposit cleared for SPEC {tier}. We&apos;ll match how {companyName}{" "}
        actually runs, then deliver it inside your OPS instance.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Package">SPEC {tier}</InfoBlock>
      <InfoBlock label="Deposit (P1 of 4)">{depositAmountFormatted}</InfoBlock>
      <InfoBlock label="Total engagement">{totalAmountFormatted}</InfoBlock>
      <InfoBlock label="Paid">{paidAtFormatted}</InfoBlock>
      <Spacer size="md" />
      <Button href={intakeUrl}>Start intake &rarr;</Button>
      <Spacer size="sm" />
      <Paragraph small>
        Stripe receipt: <a href={stripeReceiptUrl} style={{ color: "#0A0A0A", textDecoration: "underline" }}>view it here</a>.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [WHAT HAPPENS NEXT]
      </Paragraph>
      <Paragraph small>
        1 — Intake. You answer how your business operates. The intake link
        above stays live; finish in one sitting or come back.
      </Paragraph>
      <Paragraph small>
        2 — Discovery. Once intake lands, you&apos;ll get a Calendly link to
        book the discovery call.
      </Paragraph>
      <Paragraph small>
        3 — Scope. We draft a scope document with feature-by-feature
        acceptance criteria. You sign off. P2 invoice fires.
      </Paragraph>
      <Paragraph small>
        4 — Build, midpoint demo, delivery walkthrough. P3 and P4 fire as the
        work clears review.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [30-DAY GUARANTEE REFUND]
      </Paragraph>
      <Paragraph small>
        The 30-day clock starts the day we hold your delivery walkthrough —
        not today. Within that window, you can request a refund by written
        notice stating dissatisfaction. No defect proof required. Per-milestone
        refund mechanics live in the SPEC Terms of Service.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecDepositConfirmed.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  depositAmountFormatted: "$2,125.00 CAD",
  totalAmountFormatted: "$8,500.00 CAD",
  paidAtFormatted: "May 26, 2026 at 2:14 PM PDT",
  stripeReceiptUrl: "https://pay.stripe.com/receipts/preview",
  intakeUrl: "https://opsapp.co/spec/intake/preview-token",
} satisfies SpecDepositConfirmedProps;

export default SpecDepositConfirmed;

export const previewProps = SpecDepositConfirmed.PreviewProps;
