// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";
import { OPS_SUPPORT_EMAIL } from "../../constants";

/**
 * SPEC — Hold Expired (customer_requested, customer-facing notification).
 *
 * Sent to the customer when their customer_requested SPEC hold reaches the
 * 90-day cap. The parent spec_projects row flips from status='on_hold' to
 * status='stalled_on_hold' with stalled_reason='customer_requested_hold_expired'.
 * OPS is no longer actively working the engagement. The slot was already
 * freed at on-hold entry per the locked capacity semantics in
 * SPEC/03_WORKFLOW.md § Capacity-consuming states.
 *
 * Voice posture: neutral state-of-affairs notice. Names BOTH paths — resume or
 * Guarantee Refund — without pushing toward either. The Guarantee Refund window
 * runs 30 days from the deposit date per SPEC ToS § 9, so by the time a
 * 90-day customer pause expires the refund window has almost always closed
 * already; the customer is responsible for checking eligibility against the
 * terms. Operator-side action stays manual.
 *
 * Outbox contract (C.5 cron · hold-expiry.ts writes to spec_email_outbox):
 *   payload = { spec_project_id, tier }
 * The dispatcher hydrates customerName / holdEnteredAt / priorStatus /
 * contactEmail from spec_projects (and the audit_log for priorStatus if
 * needed) before invoking the typed sender.
 */

interface SpecHoldExpiredCustomerRequestedProps {
  customerName: string;
  tier: "Setup" | "Build" | "Enterprise";
  holdEnteredAt: string;
  priorStatus: string;
  contactEmail?: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecHoldExpiredCustomerRequested({
  customerName,
  tier,
  holdEnteredAt,
  priorStatus,
  contactEmail,
  unsubscribeUrl,
  list,
}: SpecHoldExpiredCustomerRequestedProps) {
  const contact = contactEmail ?? OPS_SUPPORT_EMAIL;
  return (
    <OpsEmailLayout
      preview="Your paused SPEC engagement just hit 90 days."
      eyebrow="// SPEC :: STALLED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>90 days up. Engagement marked stalled.</Headline>
      <Paragraph>
        {customerName}, the customer-requested pause on your SPEC {tier}{" "}
        engagement reached 90 days today. The engagement is now marked stalled.
        We are not actively working on it.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Status" tone="error">Stalled</InfoBlock>
      <InfoBlock label="Package">SPEC {tier}</InfoBlock>
      <InfoBlock label="Paused since">{holdEnteredAt}</InfoBlock>
      <InfoBlock label="Prior phase">{priorStatus}</InfoBlock>
      <Spacer size="md" />
      <Paragraph>
        Two paths exist. Pick it back up — reach out and we&apos;ll talk through
        where to restart. Or invoke the Guarantee Refund if you are eligible per
        the published SPEC Terms. Either path, email{" "}
        <a
          href={`mailto:${contact}`}
          style={{ color: "rgba(10,10,10,0.84)", textDecoration: "underline" }}
        >
          {contact}
        </a>
        .
      </Paragraph>
      <Paragraph>
        Nothing else changes automatically. The engagement sits in stalled
        until you decide.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [Stalled engagements stay on the books indefinitely. No auto-close, no
        auto-refund. We hold the place until you say so.]
      </Paragraph>
      <Paragraph small>
        [Guarantee Refund terms are at SPEC Terms § 9. The 30-day refund window
        runs from the deposit date — check where you stand against that before
        invoking.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecHoldExpiredCustomerRequested.PreviewProps = {
  customerName: "Marcus",
  tier: "Build",
  holdEnteredAt: "Feb 25, 2026",
  priorStatus: "Building",
  contactEmail: "jack@opsapp.co",
} satisfies SpecHoldExpiredCustomerRequestedProps;

export default SpecHoldExpiredCustomerRequested;

export const previewProps = SpecHoldExpiredCustomerRequested.PreviewProps;
