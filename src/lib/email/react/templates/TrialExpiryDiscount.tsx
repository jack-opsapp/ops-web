import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";

interface TrialExpiryDiscountProps {
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
  promoCode50: string;
  promoCode30: string;
  subscribeUrl: string;
  unsubscribeUrl: string;
}

export function TrialExpiryDiscount({
  companyName,
  daysRemaining,
  trialEndDisplay,
  promoCode50,
  promoCode30,
  subscribeUrl,
  unsubscribeUrl,
}: TrialExpiryDiscountProps) {
  return (
    <OpsEmailLayout
      preview={`${daysRemaining} days left — 50% off or 30% off, your call`}
      eyebrow="Last call"
      senderAddress={DISPATCH.email}
      mode="marketing"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Headline>Pick a plan. Pick your discount.</Headline>
      <Paragraph>
        {companyName}&apos;s OPS trial ends {trialEndDisplay}. You&apos;ve seen
        what it does for your crew. Two codes, your call &mdash; one tap to
        check out.
      </Paragraph>
      <Spacer size="md" />
      <InfoBlock label="50% off — two months">{promoCode50}</InfoBlock>
      <InfoBlock label="30% off — six months">{promoCode30}</InfoBlock>
      <Spacer size="md" />
      <Button href={subscribeUrl}>Pick a plan &rarr;</Button>
    </OpsEmailLayout>
  );
}

TrialExpiryDiscount.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  daysRemaining: 3,
  trialEndDisplay: "April 17",
  promoCode50: "CREWUP50",
  promoCode30: "STAYIN30",
  subscribeUrl: "https://app.opsapp.co/settings/billing",
  unsubscribeUrl: "https://app.opsapp.co/unsubscribe?list=trial",
} satisfies TrialExpiryDiscountProps;

export default TrialExpiryDiscount;
