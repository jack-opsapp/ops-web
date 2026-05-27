// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecOwnerApprovalGrantedProps {
  buyerName: string;
  accountHolderName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  depositAmountFormatted: string;
  checkoutUrl: string;
  expiresAtFormatted: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecOwnerApprovalGranted({
  buyerName,
  accountHolderName,
  companyName,
  tier,
  depositAmountFormatted,
  checkoutUrl,
  expiresAtFormatted,
  unsubscribeUrl,
  list,
}: SpecOwnerApprovalGrantedProps) {
  return (
    <OpsEmailLayout
      preview="Approved. Complete payment within 24 hours."
      eyebrow="// SPEC :: APPROVED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Approved. Time to pay.</Headline>
      <Paragraph>
        {buyerName}, {accountHolderName} approved your SPEC purchase for{" "}
        {companyName}. Finish payment to start the engagement.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Package">SPEC {tier}</InfoBlock>
      <InfoBlock label="Deposit (today)">{depositAmountFormatted}</InfoBlock>
      <InfoBlock label="Checkout link expires" tone="error">{expiresAtFormatted}</InfoBlock>
      <Spacer size="md" />
      <Button href={checkoutUrl}>Complete payment &rarr;</Button>
      <Divider />
      <Paragraph small>
        [Checkout window is 24 hours. If the link expires, you&apos;ll need a
        fresh approval from {accountHolderName}.]
      </Paragraph>
      <Paragraph small>
        You&apos;ll review and accept the SPEC Terms of Service at checkout.
        Once payment clears, intake opens automatically.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecOwnerApprovalGranted.PreviewProps = {
  buyerName: "Sam Reyes",
  accountHolderName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  depositAmountFormatted: "$2,125.00 CAD",
  checkoutUrl: "https://opsapp.co/spec/checkout/preview-token",
  expiresAtFormatted: "May 27, 2026 at 2:14 PM PDT",
} satisfies SpecOwnerApprovalGrantedProps;

export default SpecOwnerApprovalGranted;

export const previewProps = SpecOwnerApprovalGranted.PreviewProps;
