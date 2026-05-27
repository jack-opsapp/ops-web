// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecScopeDocSignedCustomerProps {
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  signedAtFormatted: string;
  estimatedDeliveryWindowFormatted: string;
  subscriptionMultiplierFormatted: string;
  p2AmountFormatted: string;
  p2DueDateFormatted: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecScopeDocSignedCustomer({
  buyerName,
  companyName,
  tier,
  signedAtFormatted,
  estimatedDeliveryWindowFormatted,
  subscriptionMultiplierFormatted,
  p2AmountFormatted,
  p2DueDateFormatted,
  unsubscribeUrl,
  list,
}: SpecScopeDocSignedCustomerProps) {
  return (
    <OpsEmailLayout
      preview="Scope locked. Build kicks off this week. P2 invoice incoming."
      eyebrow="// SPEC :: SCOPE LOCKED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Scope locked. Build starts.</Headline>
      <Paragraph>
        {buyerName}, you signed off the {companyName} SPEC {tier} scope. From
        this point, the engagement runs against that document. Changes go
        through the Change Order process in SPEC Terms of Service Section 7.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Scope signed">{signedAtFormatted}</InfoBlock>
      <InfoBlock label="Estimated delivery window">{estimatedDeliveryWindowFormatted}</InfoBlock>
      <InfoBlock label="Subscription multiplier (locked)">{subscriptionMultiplierFormatted}</InfoBlock>
      <InfoBlock label="P2 invoice">{p2AmountFormatted} — due {p2DueDateFormatted}</InfoBlock>
      <Spacer size="md" />
      <Paragraph>
        P2 invoice fires from Stripe within the hour. Net-15. You&apos;ll get
        a separate Stripe email with the payment link.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [HOW THE BUILD RUNS]
      </Paragraph>
      <Paragraph small>
        — Weekly written update from the founder. Same day each week.
      </Paragraph>
      <Paragraph small>
        — Midpoint demo when the first half of scope is built and tested.
        You accept the midpoint deliverable, P3 fires.
      </Paragraph>
      <Paragraph small>
        — Delivery walkthrough when everything is deployed. P4 fires. The
        30-day Guarantee Refund clock starts at that walkthrough.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecScopeDocSignedCustomer.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  signedAtFormatted: "May 30, 2026 at 4:12 PM PDT",
  estimatedDeliveryWindowFormatted: "Jul 14 – Jul 28, 2026",
  subscriptionMultiplierFormatted: "+30%",
  p2AmountFormatted: "$2,125.00 CAD",
  p2DueDateFormatted: "Jun 14, 2026",
} satisfies SpecScopeDocSignedCustomerProps;

export default SpecScopeDocSignedCustomer;

export const previewProps = SpecScopeDocSignedCustomer.PreviewProps;
