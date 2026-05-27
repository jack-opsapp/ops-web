// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecIntakeCompletedNoDiscovery1Props {
  buyerName: string;
  companyName: string;
  calendlyUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecIntakeCompletedNoDiscovery1({
  buyerName,
  companyName,
  calendlyUrl,
  unsubscribeUrl,
  list,
}: SpecIntakeCompletedNoDiscovery1Props) {
  return (
    <OpsEmailLayout
      preview="Discovery call still open. Pick a time and we'll get rolling."
      eyebrow="// SPEC :: BOOK DISCOVERY"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Discovery call still on the table.</Headline>
      <Paragraph>
        {buyerName}, your intake for {companyName} landed a week back. The
        discovery slot is still open — pick a time that works and we&apos;ll
        get scope drafted.
      </Paragraph>
      <Spacer size="md" />
      <Button href={calendlyUrl}>Book discovery &rarr;</Button>
      <Divider />
      <Paragraph small>
        [Discovery is 60 minutes, screen-share, founder-led. We&apos;ll start
        the recording at the top so you can pull anything you need later.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecIntakeCompletedNoDiscovery1.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  calendlyUrl: "https://calendly.com/jacksonsweet/spec-discovery",
} satisfies SpecIntakeCompletedNoDiscovery1Props;

export default SpecIntakeCompletedNoDiscovery1;

export const previewProps = SpecIntakeCompletedNoDiscovery1.PreviewProps;
