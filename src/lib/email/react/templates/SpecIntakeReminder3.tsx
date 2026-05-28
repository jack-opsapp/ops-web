// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecIntakeReminder3Props {
  buyerName: string;
  companyName: string;
  intakeUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecIntakeReminder3({
  buyerName,
  companyName,
  intakeUrl,
  unsubscribeUrl,
  list,
}: SpecIntakeReminder3Props) {
  return (
    <OpsEmailLayout
      preview="Final check-in on your SPEC engagement."
      eyebrow="// SPEC :: FINAL CHECK-IN"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Last one from us — for now.</Headline>
      <Paragraph>
        {buyerName}, sixty days have passed since your SPEC deposit for{" "}
        {companyName}. Intake never opened.
      </Paragraph>
      <Paragraph>
        This is the last automated reminder. We&apos;re not killing the
        engagement and we&apos;re not forfeiting your deposit — but we&apos;ll
        stop reaching out so we&apos;re not noise in your inbox.
      </Paragraph>
      <Paragraph>
        Reply to this email anytime to pick it up. Or open intake whenever
        you&apos;re ready. The link still works.
      </Paragraph>
      <Spacer size="md" />
      <Button href={intakeUrl}>Open intake &rarr;</Button>
      <Divider />
      <Paragraph small>
        [If you&apos;d rather refund, reply with &quot;refund&quot; and the
        founder will follow up personally. No automated handling on this one.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecIntakeReminder3.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  intakeUrl: "https://opsapp.co/spec/intake/preview-token",
} satisfies SpecIntakeReminder3Props;

export default SpecIntakeReminder3;

export const previewProps = SpecIntakeReminder3.PreviewProps;
