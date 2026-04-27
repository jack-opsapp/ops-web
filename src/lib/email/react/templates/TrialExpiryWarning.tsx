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
      ? "Tomorrow. Your OPS trial ends."
      : `${daysRemaining} days left on your OPS trial.`;

  const urgencyLine =
    daysRemaining === 1
      ? "This is the last notice before the app locks your crew out."
      : daysRemaining <= 5
      ? "Don't let your team get caught out. Lock in a plan before the trial ends."
      : "Plenty of time to lock it in. Every plan includes every feature.";

  return (
    <OpsEmailLayout
      preview={
        daysRemaining === 1
          ? "Tomorrow — your OPS trial ends"
          : `${daysRemaining} days left on your OPS trial`
      }
      eyebrow="Trial reminder"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{headline}</Headline>
      <Paragraph>
        Your trial ends <strong>{trialEndDisplay}</strong>. After that, the
        app locks &mdash; your crew opens it the next morning and sees
        nothing.
      </Paragraph>
      <Paragraph>
        I built OPS because every other app on the market was built by
        people who never swung a hammer. If you&apos;ve made it this far,
        you&apos;ve seen the difference. Your crew opens it, knows where to
        go, and work starts on time. That&apos;s the whole point.
      </Paragraph>
      <Paragraph>{urgencyLine}</Paragraph>
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
