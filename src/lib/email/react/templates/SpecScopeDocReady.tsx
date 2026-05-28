// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecScopeDocReadyProps {
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  featureCountFormatted: string;
  estimatedDeliveryWindowFormatted: string;
  subscriptionMultiplierFormatted: string;
  scopeUrl: string;
  p2AmountFormatted: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecScopeDocReady({
  buyerName,
  companyName,
  tier,
  featureCountFormatted,
  estimatedDeliveryWindowFormatted,
  subscriptionMultiplierFormatted,
  scopeUrl,
  p2AmountFormatted,
  unsubscribeUrl,
  list,
}: SpecScopeDocReadyProps) {
  return (
    <OpsEmailLayout
      preview="Scope document ready. Review and sign to start the build."
      eyebrow="// SPEC :: SCOPE READY FOR SIGN-OFF"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Scope is drafted. Your move.</Headline>
      <Paragraph>
        {buyerName}, the scope document for {companyName}&apos;s SPEC {tier}{" "}
        engagement is ready. Read it carefully — this is what locks the build.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Features in scope">{featureCountFormatted}</InfoBlock>
      <InfoBlock label="Estimated delivery">{estimatedDeliveryWindowFormatted}</InfoBlock>
      <InfoBlock label="Subscription multiplier (locks at sign-off)">{subscriptionMultiplierFormatted}</InfoBlock>
      <InfoBlock label="P2 invoice (fires on sign-off)">{p2AmountFormatted}</InfoBlock>
      <Spacer size="md" />
      <Button href={scopeUrl}>Open scope &rarr;</Button>
      <Divider />
      <Paragraph small>
        [WHAT TO LOOK FOR]
      </Paragraph>
      <Paragraph small>
        — Per-feature acceptance criteria. These are the bar each feature has
        to clear before it counts as built.
      </Paragraph>
      <Paragraph small>
        — Explicit exclusions. What we&apos;re not building. If something you
        expected isn&apos;t listed, flag it before signing.
      </Paragraph>
      <Paragraph small>
        — Subscription multiplier and any module surcharge. These lock at
        sign-off and apply from your first billing cycle after delivery
        walkthrough + 30 days.
      </Paragraph>
      <Paragraph small>
        Questions? Reply to this email. Sign-off is a one-way door — easier
        to ask now than amend later.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecScopeDocReady.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  featureCountFormatted: "9",
  estimatedDeliveryWindowFormatted: "6-8 weeks from sign-off",
  subscriptionMultiplierFormatted: "+30%",
  scopeUrl: "https://opsapp.co/spec/scope/preview-id",
  p2AmountFormatted: "$2,125.00 CAD",
} satisfies SpecScopeDocReadyProps;

export default SpecScopeDocReady;

export const previewProps = SpecScopeDocReady.PreviewProps;
