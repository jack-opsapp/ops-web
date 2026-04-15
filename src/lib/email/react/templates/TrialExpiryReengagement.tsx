import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";

interface TrialExpiryReengagementProps {
  companyName: string;
  daysSinceExpiry: number;
  promoCode50: string;
  promoCode30: string;
  subscribeUrl: string;
  unsubscribeUrl: string;
}

export function TrialExpiryReengagement({
  companyName,
  daysSinceExpiry,
  promoCode50,
  promoCode30,
  subscribeUrl,
  unsubscribeUrl,
}: TrialExpiryReengagementProps) {
  const headline =
    daysSinceExpiry >= 30
      ? "One last check-in."
      : "Still drowning?";
  return (
    <OpsEmailLayout
      preview={
        daysSinceExpiry >= 30
          ? "Last check-in before we stop"
          : "Still thinking about it?"
      }
      eyebrow={daysSinceExpiry >= 30 ? "Final message" : "Come back"}
      senderAddress={DISPATCH.email}
      mode="marketing"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Headline>{headline}</Headline>
      <Paragraph>
        Texts at 6am. Job sites that don&apos;t know where they&apos;re going.
        Paper invoices piling up in the truck. OPS killed all that for
        {" "}{companyName}&apos;s crew. Still here, still the same two codes.
      </Paragraph>
      <Spacer size="md" />
      <InfoBlock label="50% off — two months">{promoCode50}</InfoBlock>
      <InfoBlock label="30% off — six months">{promoCode30}</InfoBlock>
      <Spacer size="md" />
      <Button href={subscribeUrl}>Pick a plan &rarr;</Button>
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
