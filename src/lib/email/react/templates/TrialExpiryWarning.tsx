// @template-version: 1.1.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface TrialExpiryWarningProps {
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
  subscribeUrl: string;
  unsubscribeUrl: string;
  list?: string;
}

export function TrialExpiryWarning({
  daysRemaining,
  trialEndDisplay,
  subscribeUrl,
  unsubscribeUrl,
  list,
}: TrialExpiryWarningProps) {
  const headline =
    daysRemaining === 1
      ? "Your OPS trial ends tomorrow."
      : `${daysRemaining} days left on your OPS trial.`;

  const closingLine =
    daysRemaining === 1
      ? "Last reminder before it lapses. Pick a plan and your crew never notices the difference."
      : "Every plan includes every feature. Pick the one that fits your crew — change it anytime.";

  return (
    <OpsEmailLayout
      preview={
        daysRemaining === 1
          ? "Your OPS trial ends tomorrow"
          : `${daysRemaining} days left on your OPS trial`
      }
      eyebrow="Trial reminder"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{headline}</Headline>
      <Paragraph>
        Your trial ends <strong>{trialEndDisplay}</strong>. Pick a plan before
        then and nothing changes &mdash; your crew opens OPS in the morning and
        gets to work. Let it lapse and OPS locks until you&apos;re back.
      </Paragraph>
      <Paragraph>
        I built OPS because every app I tried was made by people who never ran a
        crew. No training, no manual &mdash; your crew opens it, knows where to
        go, and work starts on time. That&apos;s the whole point.
      </Paragraph>
      <Paragraph>{closingLine}</Paragraph>
      <Spacer size="md" />
      <Button href={subscribeUrl}>Pick your plan &rarr;</Button>
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

TrialExpiryWarning.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  daysRemaining: 3,
  trialEndDisplay: "April 18",
  subscribeUrl: "https://app.opsapp.co/settings/billing",
  unsubscribeUrl: "https://app.opsapp.co/unsubscribe?list=trial",
} satisfies TrialExpiryWarningProps;

export default TrialExpiryWarning;

export const previewProps = TrialExpiryWarning.PreviewProps;
