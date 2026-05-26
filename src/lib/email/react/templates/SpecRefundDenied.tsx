// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecRefundDeniedProps {
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  decidedAtFormatted: string;
  denialReason: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecRefundDenied({
  buyerName,
  companyName,
  tier,
  decidedAtFormatted,
  denialReason,
  unsubscribeUrl,
  list,
}: SpecRefundDeniedProps) {
  return (
    <OpsEmailLayout
      preview="Refund request denied. Reason inside."
      eyebrow="// SPEC :: REFUND DENIED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Refund request denied.</Headline>
      <Paragraph>
        {buyerName}, we&apos;ve reviewed your refund request on the{" "}
        {companyName} SPEC {tier} engagement and denied it. The reason is
        below. No charge was made; no money was moved.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Decided">{decidedAtFormatted}</InfoBlock>
      <InfoBlock label="Decision" tone="error">Denied</InfoBlock>
      <Spacer size="md" />
      <Paragraph>
        <strong>Reason.</strong> {denialReason}
      </Paragraph>
      <Divider />
      <Paragraph small>
        [APPEAL PATH]
      </Paragraph>
      <Paragraph small>
        If you believe the reason above is wrong — missing context, mistaken
        facts, or a misapplied clause — reply to this email with the
        correction. The founder reviews every appeal directly. Include any
        documentation that supports your position.
      </Paragraph>
      <Paragraph small>
        Decisions are made against the SPEC Terms of Service Section 9
        (Guarantee Refund eligibility) and Section 22 (refund mechanics).
        Both live at{" "}
        <a href="https://opsapp.co/legal?page=spec-terms" style={{ color: "rgba(10,10,10,0.84)", textDecoration: "underline" }}>opsapp.co/legal?page=spec-terms</a>.
      </Paragraph>
      <Paragraph small>
        Your SPEC Custom Modules remain active. Your base OPS subscription is
        unaffected.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecRefundDenied.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  decidedAtFormatted: "Aug 14, 2026 at 11:02 AM PDT",
  denialReason:
    "The 30-day Guarantee Period closed on Aug 29, 2026. Your request arrived after that date, so the Guarantee Refund is no longer available. Per SPEC Terms of Service Section 22, post-Guarantee refunds are at OPS discretion and we are not extending one in this case.",
} satisfies SpecRefundDeniedProps;

export default SpecRefundDenied;

export const previewProps = SpecRefundDenied.PreviewProps;
