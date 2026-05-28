// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecOwnerApprovalRequiredProps {
  accountHolderName: string;
  buyerName: string;
  buyerEmail: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  depositAmountFormatted: string;
  totalAmountFormatted: string;
  approveUrl: string;
  declineUrl: string;
  expiresInHoursFormatted: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecOwnerApprovalRequired({
  accountHolderName,
  buyerName,
  buyerEmail,
  companyName,
  tier,
  depositAmountFormatted,
  totalAmountFormatted,
  approveUrl,
  declineUrl,
  expiresInHoursFormatted,
  unsubscribeUrl,
  list,
}: SpecOwnerApprovalRequiredProps) {
  return (
    <OpsEmailLayout
      preview={`${buyerName} requested approval to purchase SPEC ${tier}.`}
      eyebrow="// SPEC :: APPROVAL REQUESTED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{buyerName} wants to buy SPEC for {companyName}.</Headline>
      <Paragraph>
        {accountHolderName}, your team member requested a SPEC engagement. No
        charge has been made. Nothing happens until you approve.
      </Paragraph>
      <Paragraph>
        Review the details below. Approve to send {buyerName} a checkout link.
        Decline to cancel the request.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Buyer">{buyerName} &lt;{buyerEmail}&gt;</InfoBlock>
      <InfoBlock label="Package">SPEC {tier}</InfoBlock>
      <InfoBlock label="Deposit (today)">{depositAmountFormatted}</InfoBlock>
      <InfoBlock label="Total engagement">{totalAmountFormatted}</InfoBlock>
      <Spacer size="md" />
      <Button href={approveUrl}>Approve purchase &rarr;</Button>
      <Spacer size="sm" />
      <Paragraph small>
        Not the right call? <a href={declineUrl} style={{ color: "#0A0A0A", textDecoration: "underline" }}>Decline this request</a>.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [Approval expires in {expiresInHoursFormatted} hours. After that, the
        buyer will need to restart the request.]
      </Paragraph>
      <Paragraph small>
        Approving binds your company to the SPEC Terms of Service at the
        version published today. Both your approval and the buyer&apos;s
        checkout will be recorded in the engagement&apos;s acceptance log.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecOwnerApprovalRequired.PreviewProps = {
  accountHolderName: "Marcus",
  buyerName: "Sam Reyes",
  buyerEmail: "sam@canprodecks.ca",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  depositAmountFormatted: "$2,125.00 CAD",
  totalAmountFormatted: "$8,500.00 CAD",
  approveUrl: "https://opsapp.co/spec/owner-approval/preview-approve",
  declineUrl: "https://opsapp.co/spec/owner-approval/preview-decline",
  expiresInHoursFormatted: "168",
} satisfies SpecOwnerApprovalRequiredProps;

export default SpecOwnerApprovalRequired;

export const previewProps = SpecOwnerApprovalRequired.PreviewProps;
