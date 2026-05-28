// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";
import { OPS_SUPPORT_EMAIL } from "../../constants";
import type { SpecEntitlementDisabledReason } from "./SpecEntitlementDisabled";

/**
 * SPEC — Entitlement Enabled (customer notification).
 *
 * Sent when the /admin/spec/[id] Tab 10 operator toggle re-enables a module
 * that was previously disabled with a CLEARABLE reason (non_payment, dispute,
 * customer_request, ops_decision, not_yet_delivered). Terminal reasons
 * (refunded, subscription_lapse) cannot be cleared via the operator toggle.
 *
 * Outbox contract (F.2.b · toggle-entitlement.ts writes to spec_email_outbox):
 *   payload = {
 *     spec_project_id, module_key, module_label, change_kind: 'enabled',
 *     disabled_reason: null, customer_name,
 *   }
 * `previousDisabledReason` is OPTIONAL — the toggle payload sets the new
 * disabled_reason to null but does not carry the prior value. A future
 * dispatcher can enrich from audit_log.old_data when available.
 */

interface SpecEntitlementEnabledProps {
  customerName: string;
  moduleKey: string;
  moduleLabel: string;
  previousDisabledReason?: SpecEntitlementDisabledReason | null;
  tier?: "Setup" | "Build" | "Enterprise";
  loginUrl: string;
  contactEmail?: string;
  unsubscribeUrl?: string;
  list?: string;
}

function humanizePreviousReason(r: SpecEntitlementDisabledReason): string {
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

export function SpecEntitlementEnabled({
  customerName,
  moduleKey: _moduleKey,
  moduleLabel,
  previousDisabledReason,
  tier,
  loginUrl,
  contactEmail,
  unsubscribeUrl,
  list,
}: SpecEntitlementEnabledProps) {
  const contact = contactEmail ?? OPS_SUPPORT_EMAIL;
  const tierLabel = tier ? `SPEC ${tier}` : "your SPEC engagement";
  const previousReasonHuman = previousDisabledReason
    ? humanizePreviousReason(previousDisabledReason)
    : null;
  return (
    <OpsEmailLayout
      preview={`Access restored: ${moduleLabel}. Sign in to OPS.`}
      eyebrow="// SPEC :: ACCESS RESTORED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Access restored: {moduleLabel}.</Headline>
      <Paragraph>
        {customerName}, your access to {moduleLabel} on {tierLabel} is back
        on. The module reappears in OPS-Web within a minute. Sign in below.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Module">{moduleLabel}</InfoBlock>
      <InfoBlock label="Status" tone="success">Active</InfoBlock>
      {previousReasonHuman && (
        <InfoBlock label="Previous pause cleared">{previousReasonHuman}</InfoBlock>
      )}
      <Spacer size="md" />
      {previousReasonHuman ? (
        <Paragraph>
          The pause condition that triggered the disable —{" "}
          {previousReasonHuman.toLowerCase()} — has been resolved.
        </Paragraph>
      ) : (
        <Paragraph>
          The pause condition that triggered the disable has been resolved.
        </Paragraph>
      )}
      <Spacer size="sm" />
      <Button href={loginUrl}>Sign in to OPS &rarr;</Button>
      <Divider />
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

SpecEntitlementEnabled.PreviewProps = {
  customerName: "Marcus",
  moduleKey: "ai_estimator",
  moduleLabel: "Ai Estimator",
  previousDisabledReason: "non_payment",
  tier: "Build",
  loginUrl: "https://opsapp.co/dashboard",
  contactEmail: "support@opsapp.co",
} satisfies SpecEntitlementEnabledProps;

export default SpecEntitlementEnabled;

export const previewProps = SpecEntitlementEnabled.PreviewProps;
