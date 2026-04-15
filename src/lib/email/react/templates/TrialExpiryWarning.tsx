import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer } from "../primitives";
import { DISPATCH } from "../../senders";

interface TrialExpiryWarningProps {
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
  subscribeUrl: string;
  unsubscribeUrl: string;
}

export function TrialExpiryWarning({
  companyName,
  daysRemaining,
  trialEndDisplay,
  subscribeUrl,
  unsubscribeUrl,
}: TrialExpiryWarningProps) {
  const headline =
    daysRemaining === 1
      ? "One day left."
      : `${daysRemaining} days left.`;
  return (
    <OpsEmailLayout
      preview={
        daysRemaining === 1
          ? `Tomorrow — your OPS trial ends`
          : `${daysRemaining} days left on your OPS trial`
      }
      eyebrow="Trial reminder"
      senderAddress={DISPATCH.email}
      mode="marketing"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Headline>{headline}</Headline>
      <Paragraph>
        {companyName}&apos;s OPS trial wraps on {trialEndDisplay}. Your crew&apos;s
        jobs, photos, and history don&apos;t disappear &mdash; but the app
        turns read-only until you pick a plan.
      </Paragraph>
      <Spacer size="md" />
      <Button href={subscribeUrl}>Pick a plan &rarr;</Button>
    </OpsEmailLayout>
  );
}

TrialExpiryWarning.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  daysRemaining: 3,
  trialEndDisplay: "April 17",
  subscribeUrl: "https://app.opsapp.co/settings/billing",
  unsubscribeUrl: "https://app.opsapp.co/unsubscribe?list=trial",
} satisfies TrialExpiryWarningProps;

export default TrialExpiryWarning;
