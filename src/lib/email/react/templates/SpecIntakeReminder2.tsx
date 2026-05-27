// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecIntakeReminder2Props {
  buyerName: string;
  companyName: string;
  intakeUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecIntakeReminder2({
  buyerName,
  companyName,
  intakeUrl,
  unsubscribeUrl,
  list,
}: SpecIntakeReminder2Props) {
  return (
    <OpsEmailLayout
      preview="SPEC paused. Reply or open intake when you're ready."
      eyebrow="// SPEC :: PAUSED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>SPEC for {companyName} is paused.</Headline>
      <Paragraph>
        {buyerName}, it&apos;s been 30 days since the deposit and intake
        hasn&apos;t opened. We&apos;re marking the engagement paused so it
        doesn&apos;t hold a build slot from another customer.
      </Paragraph>
      <Paragraph>
        Your deposit is safe. Nothing forfeits. When you&apos;re ready,
        open intake or reply to this email and we&apos;ll restart.
      </Paragraph>
      <Spacer size="md" />
      <Button href={intakeUrl}>Resume intake &rarr;</Button>
      <Divider />
      <Paragraph small>
        [If something changed and you want a refund instead, reply and tell
        us. Pre-discovery refund decisions are made case-by-case per the SPEC
        Terms of Service Section 22.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecIntakeReminder2.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  intakeUrl: "https://opsapp.co/spec/intake/preview-token",
} satisfies SpecIntakeReminder2Props;

export default SpecIntakeReminder2;

export const previewProps = SpecIntakeReminder2.PreviewProps;
