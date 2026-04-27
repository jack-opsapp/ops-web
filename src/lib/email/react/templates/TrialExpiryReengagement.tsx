import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import {
  Headline,
  Paragraph,
  Button,
  Spacer,
  Divider,
  emailTokens as T,
} from "../primitives";
import { Section, Row, Column, Text } from "@react-email/components";
import { DISPATCH } from "../../senders";

interface TrialExpiryReengagementProps {
  companyName: string;
  daysSinceExpiry: number;
  promoCode50: string;
  promoCode30: string;
  subscribeUrl: string;
  unsubscribeUrl: string;
  list?: string;
}

function PromoCodeBox({
  optionLabel,
  code,
}: {
  optionLabel: string;
  code: string;
}) {
  return (
    <Section
      style={{
        border: `1px solid ${T.color.paperRule}`,
        padding: T.spacing.md,
        margin: `${T.spacing.sm} 0`,
      }}
    >
      <Row>
        <Column>
          <Text
            style={{
              margin: `0 0 ${T.spacing.xs} 0`,
              fontFamily: T.font.label,
              fontSize: T.size.eyebrow,
              lineHeight: T.size.eyebrowLine,
              letterSpacing: T.tracking.eyebrow,
              textTransform: "uppercase",
              color: T.color.paperTextSecondary,
            }}
          >
            {optionLabel}
          </Text>
          <Text
            style={{
              margin: 0,
              fontFamily: "'Courier New', Menlo, Monaco, monospace",
              fontSize: "20px",
              lineHeight: "24px",
              fontWeight: T.weight.bold,
              letterSpacing: "0.04em",
              color: T.color.ink,
            }}
          >
            {code}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

export function TrialExpiryReengagement({
  daysSinceExpiry,
  promoCode50,
  promoCode30,
  subscribeUrl,
  unsubscribeUrl,
  list,
}: TrialExpiryReengagementProps) {
  const isFinal = daysSinceExpiry >= 30;

  const headline = isFinal
    ? "Last check-in before we stop."
    : "Still thinking about it?";

  const opener = isFinal
    ? "Your OPS trial ended a month ago. This is the last time I'll knock on the door."
    : "Your OPS trial ended a week ago. Figured I'd check in once before I stopped.";

  const middle = isFinal
    ? "I know what it's like to try new software while running a crew — something always catches fire and the new tool gets shelved. No hard feelings. But if you want to come back, I'm going to make it easy."
    : "Whatever pulled you away — bad timing, crew pushback, a fire on another job — I get it. Running a trades business means everything else gets interrupted by the thing on fire right now.";

  return (
    <OpsEmailLayout
      preview={
        isFinal
          ? "Last check-in before we stop"
          : "Still thinking about it?"
      }
      eyebrow={isFinal ? "Final message" : "Come back"}
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{headline}</Headline>
      <Paragraph>{opener}</Paragraph>
      <Paragraph>{middle}</Paragraph>
      <Spacer size="sm" />
      <PromoCodeBox
        optionLabel="Option A — 50% off for 2 months"
        code={promoCode50}
      />
      <PromoCodeBox
        optionLabel="Option B — 30% off for 6 months"
        code={promoCode30}
      />
      <Spacer size="sm" />
      <Paragraph>
        Your data is still sitting there. Your crew is still one subscription
        away from opening the app tomorrow morning and knowing exactly where
        to be.
      </Paragraph>
      <Spacer size="md" />
      <Button href={subscribeUrl}>Come back to OPS &rarr;</Button>
      <Spacer size="lg" />
      <Divider spacing="sm" />
      <Paragraph small>
        &mdash; Jack
        <br />
        Founder, OPS
      </Paragraph>
    </OpsEmailLayout>
  );
}

TrialExpiryReengagement.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  daysSinceExpiry: 7,
  promoCode50: "CREWUP50",
  promoCode30: "STAYIN30",
  subscribeUrl: "https://app.opsapp.co/settings/billing",
  unsubscribeUrl: "https://app.opsapp.co/unsubscribe?list=trial",
} satisfies TrialExpiryReengagementProps;

export default TrialExpiryReengagement;
