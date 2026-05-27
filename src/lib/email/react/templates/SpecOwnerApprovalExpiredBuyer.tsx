// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

/**
 * SPEC — Owner Approval Expired (buyer-facing notification).
 *
 * Sent to a Path B team-member buyer when their owner-approval request times
 * out after the 7-day window without an approve/decline from the
 * account_holder. The parent spec_projects row is flipped to status='cancelled'
 * with cancellation_reason='owner_approval_expired'. No Stripe charge ever
 * fired — this email confirms the timeout and offers a restart path.
 *
 * Outbox contract (C.5 cron · owner-approval-expiry.ts writes to spec_email_outbox):
 *   payload = { spec_project_id, tier }
 * The dispatcher hydrates buyerName / accountHolderName / companyName /
 * originalRequestedAt / retryUrl from spec_projects + spec_owner_approval_requests
 * + users lookups before invoking the typed sender.
 */

interface SpecOwnerApprovalExpiredBuyerProps {
  buyerName: string;
  accountHolderName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  originalRequestedAt: string;
  retryUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecOwnerApprovalExpiredBuyer({
  buyerName,
  accountHolderName,
  companyName,
  tier,
  originalRequestedAt,
  retryUrl,
  unsubscribeUrl,
  list,
}: SpecOwnerApprovalExpiredBuyerProps) {
  return (
    <OpsEmailLayout
      preview="Your owner did not approve in time. No charge was made."
      eyebrow="// SPEC :: EXPIRED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Expired. No charge was made.</Headline>
      <Paragraph>
        {buyerName}, the 7-day approval window on your SPEC {tier} request for{" "}
        {companyName} closed without a response from {accountHolderName}. Your
        card was never touched. The request is cancelled.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Status">No charge. No engagement.</InfoBlock>
      <InfoBlock label="Approver">{accountHolderName}</InfoBlock>
      <InfoBlock label="Package">SPEC {tier}</InfoBlock>
      <InfoBlock label="Requested">{originalRequestedAt}</InfoBlock>
      <Spacer size="md" />
      <Paragraph>
        Start over below. A new request sends {accountHolderName} a fresh
        approval ping and resets the 7-day window.
      </Paragraph>
      <Spacer size="sm" />
      <Button href={retryUrl}>Restart request &rarr;</Button>
      <Divider />
      <Paragraph small>
        [7 days is the hard window. Approvals after that need to come through a
        new request — there is no extending an expired one.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecOwnerApprovalExpiredBuyer.PreviewProps = {
  buyerName: "Sam Reyes",
  accountHolderName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  originalRequestedAt: "May 20, 2026",
  retryUrl: "https://opsapp.co/spec",
} satisfies SpecOwnerApprovalExpiredBuyerProps;

export default SpecOwnerApprovalExpiredBuyer;

export const previewProps = SpecOwnerApprovalExpiredBuyer.PreviewProps;
