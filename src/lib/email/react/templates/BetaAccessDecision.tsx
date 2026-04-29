// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import {
  Headline,
  Paragraph,
  Button,
  Spacer,
  emailTokens as T,
} from "../primitives";
import { Section, Row, Column, Text } from "@react-email/components";
import { DISPATCH } from "../../senders";

interface BetaAccessDecisionProps {
  userName: string;
  featureTitle: string;
  approved: boolean;
  adminNotes: string | null;
  unsubscribeUrl?: string;
  list?: string;
}

function AdminNotesQuote({ notes }: { notes: string }) {
  return (
    <Section
      style={{
        borderLeft: `2px solid #597794`,
        paddingLeft: T.spacing.md,
        margin: `${T.spacing.md} 0`,
      }}
    >
      <Row>
        <Column>
          <Text
            style={{
              margin: 0,
              fontFamily: T.font.sans,
              fontSize: T.size.small,
              lineHeight: T.size.smallLine,
              color: T.color.paperTextSecondary,
              fontStyle: "italic",
            }}
          >
            {notes}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

export function BetaAccessDecision({
  userName,
  featureTitle,
  approved,
  adminNotes,
  unsubscribeUrl,
  list,
}: BetaAccessDecisionProps) {
  return (
    <OpsEmailLayout
      preview={
        approved
          ? `You're in — ${featureTitle}`
          : `Beta decision — ${featureTitle}`
      }
      eyebrow={approved ? "Beta approved" : "Beta decision"}
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      {approved ? (
        <>
          <Headline>You&apos;re in, {userName}.</Headline>
          <Paragraph>
            Your request to test <strong>{featureTitle}</strong> has been
            approved.
          </Paragraph>
          <Paragraph>
            Open OPS to try it out. We&apos;d love to hear your feedback.
          </Paragraph>
          {adminNotes ? <AdminNotesQuote notes={adminNotes} /> : null}
          <Spacer size="md" />
          <Button href="https://app.opsapp.co">Open OPS &rarr;</Button>
        </>
      ) : (
        <>
          <Headline>Thanks for your interest, {userName}.</Headline>
          <Paragraph>
            Thanks for requesting access to <strong>{featureTitle}</strong>.
          </Paragraph>
          <Paragraph>
            We&apos;re not ready to add more testers right now, but
            we&apos;ll notify you when it becomes available.
          </Paragraph>
          {adminNotes ? <AdminNotesQuote notes={adminNotes} /> : null}
          <Spacer size="md" />
          <Button href="https://app.opsapp.co">Open OPS &rarr;</Button>
        </>
      )}
    </OpsEmailLayout>
  );
}

BetaAccessDecision.PreviewProps = {
  userName: "Jackson",
  featureTitle: "Deck Builder",
  approved: true,
  adminNotes:
    "Your deck-and-rail background is exactly who we want testing this. Expect a direct message from the team this week.",
} satisfies BetaAccessDecisionProps;

export default BetaAccessDecision;

export const previewProps = BetaAccessDecision.PreviewProps;
