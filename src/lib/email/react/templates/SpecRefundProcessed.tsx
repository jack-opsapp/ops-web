// @template-version: 1.0.0
import * as React from "react";
import { Section, Row, Column, Text } from "@react-email/components";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Spacer, InfoBlock, Divider, emailTokens as T } from "../primitives";
import { DISPATCH } from "../../senders";

/**
 * One row of the per-milestone refund breakdown rendered in the email body.
 * Mirrors the shape of `spec_refund_requests.refund_breakdown[*]` per
 * SPEC/02_DATA_MODEL.md.
 */
export interface SpecRefundBreakdownRow {
  milestoneLabel: string;
  actionLabel: string;
  amountFormatted: string;
  status: string;
}

interface SpecRefundProcessedProps {
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  totalRefundedFormatted: string;
  processedAtFormatted: string;
  isGuaranteeInvocation: boolean;
  breakdown: SpecRefundBreakdownRow[];
  feedbackUrl?: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecRefundProcessed({
  buyerName,
  companyName,
  tier,
  totalRefundedFormatted,
  processedAtFormatted,
  isGuaranteeInvocation,
  breakdown,
  feedbackUrl,
  unsubscribeUrl,
  list,
}: SpecRefundProcessedProps) {
  return (
    <OpsEmailLayout
      preview={`Refund processed — ${totalRefundedFormatted}.`}
      eyebrow="// SPEC :: REFUND PROCESSED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Refund processed.</Headline>
      <Paragraph>
        {buyerName}, your {isGuaranteeInvocation ? "30-day Guarantee Refund" : "refund request"}{" "}
        for the {companyName} SPEC {tier} engagement is processed.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Total refunded">{totalRefundedFormatted}</InfoBlock>
      <InfoBlock label="Processed">{processedAtFormatted}</InfoBlock>
      <Spacer size="md" />
      <Paragraph>
        Per-milestone breakdown:
      </Paragraph>
      <Section
        style={{
          border: `1px solid ${T.color.paperRule}`,
          padding: T.spacing.md,
          margin: `${T.spacing.sm} 0`,
        }}
      >
        <Row>
          <Column style={{ width: "22%", paddingRight: T.spacing.xs }}>
            <Text
              style={{
                margin: 0,
                fontFamily: T.font.label,
                fontSize: T.size.eyebrow,
                lineHeight: T.size.eyebrowLine,
                letterSpacing: T.tracking.eyebrow,
                textTransform: "uppercase",
                color: T.color.paperTextSecondary,
              }}
            >
              Milestone
            </Text>
          </Column>
          <Column style={{ width: "33%", paddingRight: T.spacing.xs }}>
            <Text
              style={{
                margin: 0,
                fontFamily: T.font.label,
                fontSize: T.size.eyebrow,
                lineHeight: T.size.eyebrowLine,
                letterSpacing: T.tracking.eyebrow,
                textTransform: "uppercase",
                color: T.color.paperTextSecondary,
              }}
            >
              Action
            </Text>
          </Column>
          <Column style={{ width: "25%", paddingRight: T.spacing.xs }}>
            <Text
              style={{
                margin: 0,
                fontFamily: T.font.label,
                fontSize: T.size.eyebrow,
                lineHeight: T.size.eyebrowLine,
                letterSpacing: T.tracking.eyebrow,
                textTransform: "uppercase",
                color: T.color.paperTextSecondary,
              }}
            >
              Amount
            </Text>
          </Column>
          <Column style={{ width: "20%" }}>
            <Text
              style={{
                margin: 0,
                fontFamily: T.font.label,
                fontSize: T.size.eyebrow,
                lineHeight: T.size.eyebrowLine,
                letterSpacing: T.tracking.eyebrow,
                textTransform: "uppercase",
                color: T.color.paperTextSecondary,
              }}
            >
              Status
            </Text>
          </Column>
        </Row>
        {breakdown.map((row, idx) => (
          <Row key={idx}>
            <Column
              style={{
                width: "22%",
                paddingTop: T.spacing.xs,
                paddingRight: T.spacing.xs,
                borderTop: idx === 0 ? `1px solid ${T.color.paperRule}` : "none",
              }}
            >
              <Text
                style={{
                  margin: `${T.spacing.xs} 0 0 0`,
                  fontFamily: T.font.label,
                  fontSize: T.size.small,
                  lineHeight: T.size.smallLine,
                  color: T.color.paperTextPrimary,
                }}
              >
                {row.milestoneLabel}
              </Text>
            </Column>
            <Column
              style={{
                width: "33%",
                paddingTop: T.spacing.xs,
                paddingRight: T.spacing.xs,
                borderTop: idx === 0 ? `1px solid ${T.color.paperRule}` : "none",
              }}
            >
              <Text
                style={{
                  margin: `${T.spacing.xs} 0 0 0`,
                  fontFamily: T.font.sans,
                  fontSize: T.size.small,
                  lineHeight: T.size.smallLine,
                  color: T.color.paperTextPrimary,
                }}
              >
                {row.actionLabel}
              </Text>
            </Column>
            <Column
              style={{
                width: "25%",
                paddingTop: T.spacing.xs,
                paddingRight: T.spacing.xs,
                borderTop: idx === 0 ? `1px solid ${T.color.paperRule}` : "none",
              }}
            >
              <Text
                style={{
                  margin: `${T.spacing.xs} 0 0 0`,
                  fontFamily: T.font.label,
                  fontSize: T.size.small,
                  lineHeight: T.size.smallLine,
                  color: T.color.paperTextPrimary,
                }}
              >
                {row.amountFormatted}
              </Text>
            </Column>
            <Column
              style={{
                width: "20%",
                paddingTop: T.spacing.xs,
                borderTop: idx === 0 ? `1px solid ${T.color.paperRule}` : "none",
              }}
            >
              <Text
                style={{
                  margin: `${T.spacing.xs} 0 0 0`,
                  fontFamily: T.font.label,
                  fontSize: T.size.small,
                  lineHeight: T.size.smallLine,
                  letterSpacing: T.tracking.meta,
                  textTransform: "uppercase",
                  color: T.color.paperTextSecondary,
                }}
              >
                {row.status}
              </Text>
            </Column>
          </Row>
        ))}
      </Section>
      <Divider />
      <Paragraph small>
        [TIMELINE]
      </Paragraph>
      <Paragraph small>
        Funds typically land in 5 to 10 business days, depending on your card
        issuer. Voided invoices show as voided in Stripe immediately. Credit
        notes show on the original invoice.
      </Paragraph>
      <Paragraph small>
        Your SPEC Custom Modules have been disabled. Your base OPS subscription
        is unaffected. Per SPEC Terms of Service Section 9, continued use of
        the refunded Modules — including exporting data from them and
        reinserting it elsewhere in OPS — is a material breach.
      </Paragraph>
      {feedbackUrl && (
        <>
          <Paragraph small>
            [FEEDBACK]
          </Paragraph>
          <Paragraph small>
            We&apos;d learn from a few minutes of your time. What didn&apos;t
            work, what you wish we&apos;d done differently — no spin, no
            scripts:{" "}
            <a href={feedbackUrl} style={{ color: "rgba(10,10,10,0.84)", textDecoration: "underline" }}>tell us here</a>.
          </Paragraph>
        </>
      )}
    </OpsEmailLayout>
  );
}

SpecRefundProcessed.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  totalRefundedFormatted: "$5,312.50 CAD",
  processedAtFormatted: "Aug 14, 2026 at 11:02 AM PDT",
  isGuaranteeInvocation: true,
  breakdown: [
    {
      milestoneLabel: "P1",
      actionLabel: "Refunded to original card",
      amountFormatted: "$2,125.00",
      status: "Done",
    },
    {
      milestoneLabel: "P2",
      actionLabel: "Refunded to original card",
      amountFormatted: "$2,125.00",
      status: "Done",
    },
    {
      milestoneLabel: "P3",
      actionLabel: "Invoice voided",
      amountFormatted: "$2,125.00",
      status: "Voided",
    },
    {
      milestoneLabel: "P4",
      actionLabel: "Credit note + partial refund",
      amountFormatted: "$1,062.50",
      status: "Done",
    },
  ],
  feedbackUrl: "https://opsapp.co/spec/feedback/preview",
} satisfies SpecRefundProcessedProps;

export default SpecRefundProcessed;

export const previewProps = SpecRefundProcessed.PreviewProps;
