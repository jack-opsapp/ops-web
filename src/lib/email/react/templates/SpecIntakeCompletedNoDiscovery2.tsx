// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecIntakeCompletedNoDiscovery2Props {
  buyerName: string;
  companyName: string;
  calendlyUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecIntakeCompletedNoDiscovery2({
  buyerName,
  companyName,
  calendlyUrl,
  unsubscribeUrl,
  list,
}: SpecIntakeCompletedNoDiscovery2Props) {
  return (
    <OpsEmailLayout
      preview="SPEC paused — discovery still unbooked."
      eyebrow="// SPEC :: PAUSED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>SPEC paused at the discovery step.</Headline>
      <Paragraph>
        {buyerName}, intake landed three weeks back but discovery never got
        booked. We&apos;re marking the engagement for {companyName} paused so
        we don&apos;t hold capacity from other customers.
      </Paragraph>
      <Paragraph>
        Pick a time and we&apos;ll un-pause and pick up where we left off.
        Your intake answers are still saved.
      </Paragraph>
      <Spacer size="md" />
      <Button href={calendlyUrl}>Book discovery &rarr;</Button>
      <Divider />
      <Paragraph small>
        [Need a different time than Calendly shows? Reply to this email and
        we&apos;ll work around your schedule.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecIntakeCompletedNoDiscovery2.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  calendlyUrl: "https://calendly.com/jacksonsweet/spec-discovery",
} satisfies SpecIntakeCompletedNoDiscovery2Props;

export default SpecIntakeCompletedNoDiscovery2;

export const previewProps = SpecIntakeCompletedNoDiscovery2.PreviewProps;
