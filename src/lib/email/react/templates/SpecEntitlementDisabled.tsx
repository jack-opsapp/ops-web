// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";
import { OPS_SUPPORT_EMAIL } from "../../constants";

/**
 * SPEC — Entitlement Disabled (customer notification).
 *
 * Sent when the /admin/spec/[id] Tab 10 operator toggle flips a delivered
 * module from enabled=true → enabled=false. The customer loses immediate
 * access to the module in OPS-Web.
 *
 * Outbox contract (F.2.b · toggle-entitlement.ts writes to spec_email_outbox):
 *   payload = {
 *     spec_project_id, module_key, module_label, change_kind: 'disabled',
 *     disabled_reason: SpecEntitlementDisabledReason, customer_name,
 *   }
 * The dispatcher hydrates the optional tier / restoreInstructionsUrl /
 * contactEmail fields from spec_projects + the disabled_reason mapping.
 *
 * Legal sensitivity: the `refunded` branch is mandatory and references the
 * 30-day Guarantee Refund terms (SPEC ToS § 9). The refund itself is
 * communicated separately via spec.refund_processed — this email only
 * confirms the consequent access disable.
 */

export type SpecEntitlementDisabledReason =
  | "non_payment"
  | "dispute"
  | "refunded"
  | "subscription_lapse"
  | "customer_request"
  | "ops_decision"
  | "not_yet_delivered";

interface SpecEntitlementDisabledProps {
  customerName: string;
  moduleKey: string;
  moduleLabel: string;
  disabledReason: SpecEntitlementDisabledReason;
  tier?: "Setup" | "Build" | "Enterprise";
  restoreInstructionsUrl?: string | null;
  contactEmail?: string;
  unsubscribeUrl?: string;
  list?: string;
}

function humanizeReason(r: SpecEntitlementDisabledReason): string {
  switch (r) {
    case "non_payment":
      return "Non-payment";
    case "dispute":
      return "Billing dispute";
    case "refunded":
      return "Refund processed";
    case "subscription_lapse":
      return "Subscription lapsed";
    case "customer_request":
      return "Customer request";
    case "ops_decision":
      return "Operator decision";
    case "not_yet_delivered":
      return "Not yet delivered";
  }
}

function ReasonBody({
  reason,
  moduleLabel,
  restoreInstructionsUrl,
}: {
  reason: SpecEntitlementDisabledReason;
  moduleLabel: string;
  restoreInstructionsUrl?: string | null;
}) {
  switch (reason) {
    case "non_payment":
      return (
        <>
          <Paragraph>
            An outstanding invoice on this engagement is past due. Settle the
            invoice and access to {moduleLabel} resumes within minutes — no
            other action required.
          </Paragraph>
          {restoreInstructionsUrl && (
            <>
              <Spacer size="sm" />
              <Button href={restoreInstructionsUrl}>View invoice &rarr;</Button>
            </>
          )}
        </>
      );
    case "dispute":
      return (
        <Paragraph>
          A billing dispute on this engagement is open. The module stays
          offline while we work it. Reply to this email when you&apos;re
          ready to resolve.
        </Paragraph>
      );
    case "refunded":
      return (
        <>
          <Paragraph>
            This engagement was refunded under the 30-day Guarantee Refund.
            Per the SPEC Terms of Service Section 9, access to {moduleLabel}{" "}
            is permanently disabled for this engagement. The refund itself
            was communicated separately — see the refund processed notice in
            your inbox.
          </Paragraph>
          <Paragraph>
            Continued use of the refunded module — including exporting data
            from it and reinserting it elsewhere in OPS — is a material
            breach of the SPEC Terms.
          </Paragraph>
        </>
      );
    case "subscription_lapse":
      return (
        <Paragraph>
          Your underlying OPS subscription is no longer active. Reactivate
          billing and access to {moduleLabel} resumes automatically.
        </Paragraph>
      );
    case "customer_request":
      return (
        <Paragraph>
          You asked us to pause this module. Let us know when you want it
          back on — we&apos;ll restore access the same day.
        </Paragraph>
      );
    case "ops_decision":
      return (
        <Paragraph>
          We&apos;ve taken {moduleLabel} offline. The reasoning is in a
          separate message — check your inbox, or reply to this email if you
          don&apos;t see it.
        </Paragraph>
      );
    case "not_yet_delivered":
      return (
        <Paragraph>
          {moduleLabel} hasn&apos;t shipped to you yet. Build continues per
          the scope document. You&apos;ll receive a separate notice the day
          access goes live.
        </Paragraph>
      );
  }
}

export function SpecEntitlementDisabled({
  customerName,
  moduleKey: _moduleKey,
  moduleLabel,
  disabledReason,
  tier,
  restoreInstructionsUrl,
  contactEmail,
  unsubscribeUrl,
  list,
}: SpecEntitlementDisabledProps) {
  const contact = contactEmail ?? OPS_SUPPORT_EMAIL;
  const reasonHuman = humanizeReason(disabledReason);
  const tierLabel = tier ? `SPEC ${tier}` : "your SPEC engagement";
  return (
    <OpsEmailLayout
      preview={`Access paused: ${moduleLabel}. Reason: ${reasonHuman}.`}
      eyebrow="// SPEC :: ACCESS PAUSED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Access paused: {moduleLabel}.</Headline>
      <Paragraph>
        {customerName}, your access to {moduleLabel} on {tierLabel} has been
        paused. The module is offline in OPS-Web starting today.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Module">{moduleLabel}</InfoBlock>
      <InfoBlock label="Status" tone="error">Paused</InfoBlock>
      <InfoBlock label="Reason">{reasonHuman}</InfoBlock>
      <Spacer size="md" />
      <ReasonBody
        reason={disabledReason}
        moduleLabel={moduleLabel}
        restoreInstructionsUrl={restoreInstructionsUrl}
      />
      <Divider />
      <Paragraph small>
        [WHAT THIS MEANS]
      </Paragraph>
      <Paragraph small>
        Only access to {moduleLabel} is affected. Other SPEC modules and
        your base OPS subscription remain unchanged.
      </Paragraph>
      <Paragraph small>
        [QUESTIONS]
      </Paragraph>
      <Paragraph small>
        Reply to this email, or write{" "}
        <a
          href={`mailto:${contact}`}
          style={{ color: "rgba(10,10,10,0.84)", textDecoration: "underline" }}
        >
          {contact}
        </a>
        .
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecEntitlementDisabled.PreviewProps = {
  customerName: "Marcus",
  moduleKey: "ai_estimator",
  moduleLabel: "Ai Estimator",
  disabledReason: "non_payment",
  tier: "Build",
  restoreInstructionsUrl: "https://opsapp.co/billing/invoices",
  contactEmail: "support@opsapp.co",
} satisfies SpecEntitlementDisabledProps;

export default SpecEntitlementDisabled;

export const previewProps = SpecEntitlementDisabled.PreviewProps;
