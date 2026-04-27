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

interface TrialExpiryDiscountProps {
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
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
              fontFamily:
                "'Courier New', Menlo, Monaco, monospace",
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

export function TrialExpiryDiscount({
  daysRemaining,
  trialEndDisplay,
  promoCode50,
  promoCode30,
  subscribeUrl,
  unsubscribeUrl,
  list,
}: TrialExpiryDiscountProps) {
  return (
    <OpsEmailLayout
      preview={`${daysRemaining} days left — 50% off or 30% off, your call`}
      eyebrow="Last call"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>
        {daysRemaining} days left &mdash; 50% off or 30% off, your call.
      </Headline>
      <Paragraph>
        Your OPS trial ends <strong>{trialEndDisplay}</strong>.
      </Paragraph>
      <Paragraph>
        Before that happens, I want to put something on the table. Two codes.
        Your choice at checkout.
      </Paragraph>
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
        If you&apos;re still getting the feel for it and want to save the most
        up front, use Option A. If you want a longer runway at a discount,
        use Option B. Same app either way &mdash; every tier gets every
        feature.
      </Paragraph>
      <Spacer size="md" />
      <Button href={subscribeUrl}>Subscribe with your code &rarr;</Button>
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

TrialExpiryDiscount.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  daysRemaining: 3,
  trialEndDisplay: "April 18",
  promoCode50: "CREWUP50",
  promoCode30: "STAYIN30",
  subscribeUrl: "https://app.opsapp.co/settings/billing",
  unsubscribeUrl: "https://app.opsapp.co/unsubscribe?list=trial",
} satisfies TrialExpiryDiscountProps;

export default TrialExpiryDiscount;
