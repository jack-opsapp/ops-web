// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecIntakeReminder1Props {
  buyerName: string;
  companyName: string;
  intakeUrl: string;
  daysSinceDepositFormatted: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecIntakeReminder1({
  buyerName,
  companyName,
  intakeUrl,
  daysSinceDepositFormatted,
  unsubscribeUrl,
  list,
}: SpecIntakeReminder1Props) {
  return (
    <OpsEmailLayout
      preview="Your SPEC intake is waiting. 15 minutes of work to keep this moving."
      eyebrow="// SPEC :: INTAKE WAITING"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Intake is the next move.</Headline>
      <Paragraph>
        {buyerName}, your SPEC deposit cleared {daysSinceDepositFormatted} days
        ago and your intake form is still open. We can&apos;t draft scope until
        you walk us through how {companyName} runs.
      </Paragraph>
      <Paragraph>
        Fifteen minutes, give or take. Save as you go — answers persist.
      </Paragraph>
      <Spacer size="md" />
      <Button href={intakeUrl}>Open intake &rarr;</Button>
      <Divider />
      <Paragraph small>
        [If life is in the way, that&apos;s fine. Pick it up when you&apos;re
        ready. We&apos;ll check back in two weeks.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecIntakeReminder1.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  intakeUrl: "https://opsapp.co/spec/intake/preview-token",
  daysSinceDepositFormatted: "14",
} satisfies SpecIntakeReminder1Props;

export default SpecIntakeReminder1;

export const previewProps = SpecIntakeReminder1.PreviewProps;
