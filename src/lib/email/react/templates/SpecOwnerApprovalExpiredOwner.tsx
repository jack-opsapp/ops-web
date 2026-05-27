// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

/**
 * SPEC — Owner Approval Expired (account_holder-facing notification).
 *
 * Sent to the account_holder whose team-member's SPEC purchase request sat for
 * 7 days without an approve/decline decision. Informational only — no charge
 * fired, the buyer is notified separately via spec.owner_approval_expired_buyer,
 * and the account_holder can self-initiate SPEC by signing in and starting the
 * flow at /spec themselves if they want it.
 *
 * Outbox contract (C.5 cron · owner-approval-expiry.ts writes to spec_email_outbox):
 *   payload = { spec_project_id, tier, buyer_name }
 * The dispatcher hydrates accountHolderName / companyName / originalRequestedAt
 * from spec_projects + users lookups before invoking the typed sender.
 */

interface SpecOwnerApprovalExpiredOwnerProps {
  accountHolderName: string;
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  originalRequestedAt: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecOwnerApprovalExpiredOwner({
  accountHolderName,
  buyerName,
  companyName,
  tier,
  originalRequestedAt,
  unsubscribeUrl,
  list,
}: SpecOwnerApprovalExpiredOwnerProps) {
  return (
    <OpsEmailLayout
      preview={`${buyerName}'s SPEC request sat 7 days. Cancelled. No charge.`}
      eyebrow="// SPEC :: EXPIRED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Expired. {buyerName}&apos;s request timed out.</Headline>
      <Paragraph>
        {accountHolderName}, the SPEC {tier} request from {buyerName} for{" "}
        {companyName} sat for 7 days without a decision. The request is
        cancelled. No card was ever touched.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Status">No charge. Request cancelled.</InfoBlock>
      <InfoBlock label="Buyer">{buyerName}</InfoBlock>
      <InfoBlock label="Package">SPEC {tier}</InfoBlock>
      <InfoBlock label="Requested">{originalRequestedAt}</InfoBlock>
      <Spacer size="md" />
      <Paragraph>
        {buyerName} has been notified. If you want SPEC for {companyName}{" "}
        yourself, sign in to OPS and start the flow at{" "}
        <a
          href="https://opsapp.co/spec"
          style={{ color: "rgba(10,10,10,0.84)", textDecoration: "underline" }}
        >
          /spec
        </a>{" "}
        — there is no need to wait on another request from your team.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [Approvals are 7-day windows by design. There is no reviving an expired
        request — every new one goes through fresh.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecOwnerApprovalExpiredOwner.PreviewProps = {
  accountHolderName: "Marcus",
  buyerName: "Sam Reyes",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  originalRequestedAt: "May 20, 2026",
} satisfies SpecOwnerApprovalExpiredOwnerProps;

export default SpecOwnerApprovalExpiredOwner;

export const previewProps = SpecOwnerApprovalExpiredOwner.PreviewProps;
