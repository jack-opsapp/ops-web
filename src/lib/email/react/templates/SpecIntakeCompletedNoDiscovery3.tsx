// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecIntakeCompletedNoDiscovery3Props {
  buyerName: string;
  companyName: string;
  calendlyUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecIntakeCompletedNoDiscovery3({
  buyerName,
  companyName,
  calendlyUrl,
  unsubscribeUrl,
  list,
}: SpecIntakeCompletedNoDiscovery3Props) {
  return (
    <OpsEmailLayout
      preview="Final check-in on your SPEC discovery."
      eyebrow="// SPEC :: FINAL CHECK-IN"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Last automated note.</Headline>
      <Paragraph>
        {buyerName}, sixty days since you finished intake for {companyName}{" "}
        and discovery never booked. We&apos;ll stop chasing — but the
        engagement isn&apos;t cancelled and your deposit isn&apos;t forfeit.
      </Paragraph>
      <Paragraph>
        Reply to this email anytime to restart. Or pick a discovery slot when
        you&apos;re ready and we&apos;ll handle the rest.
      </Paragraph>
      <Spacer size="md" />
      <Button href={calendlyUrl}>Book discovery &rarr;</Button>
      <Divider />
      <Paragraph small>
        [Want a refund instead? Reply with &quot;refund&quot; and the founder
        will follow up. Pre-scope refund decisions are case-by-case per SPEC
        Terms of Service Section 22.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecIntakeCompletedNoDiscovery3.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  calendlyUrl: "https://calendly.com/jacksonsweet/spec-discovery",
} satisfies SpecIntakeCompletedNoDiscovery3Props;

export default SpecIntakeCompletedNoDiscovery3;

export const previewProps = SpecIntakeCompletedNoDiscovery3.PreviewProps;
