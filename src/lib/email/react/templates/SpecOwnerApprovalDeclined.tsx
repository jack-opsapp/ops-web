// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecOwnerApprovalDeclinedProps {
  buyerName: string;
  accountHolderName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecOwnerApprovalDeclined({
  buyerName,
  accountHolderName,
  companyName,
  tier,
  unsubscribeUrl,
  list,
}: SpecOwnerApprovalDeclinedProps) {
  return (
    <OpsEmailLayout
      preview="Your SPEC purchase was not approved."
      eyebrow="// SPEC :: DECLINED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Declined. No charge was made.</Headline>
      <Paragraph>
        {buyerName}, {accountHolderName} declined the SPEC {tier} purchase for{" "}
        {companyName}. Your card was never touched. There is no refund to
        process.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Status">No charge. No engagement.</InfoBlock>
      <InfoBlock label="Decision by">{accountHolderName}</InfoBlock>
      <Spacer size="md" />
      <Paragraph>
        If you want to revisit this, talk to {accountHolderName} directly.
        Restarting requires their approval again.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [Questions about why? That conversation belongs with your account
        holder, not OPS. We don&apos;t see their reasoning.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecOwnerApprovalDeclined.PreviewProps = {
  buyerName: "Sam Reyes",
  accountHolderName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
} satisfies SpecOwnerApprovalDeclinedProps;

export default SpecOwnerApprovalDeclined;

export const previewProps = SpecOwnerApprovalDeclined.PreviewProps;
