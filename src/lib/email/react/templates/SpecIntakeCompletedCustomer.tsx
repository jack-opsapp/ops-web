// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecIntakeCompletedCustomerProps {
  buyerName: string;
  companyName: string;
  submittedAtFormatted: string;
  calendlyUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecIntakeCompletedCustomer({
  buyerName,
  companyName,
  submittedAtFormatted,
  calendlyUrl,
  unsubscribeUrl,
  list,
}: SpecIntakeCompletedCustomerProps) {
  return (
    <OpsEmailLayout
      preview="Intake received. Book your discovery call."
      eyebrow="// SPEC :: INTAKE RECEIVED"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Intake received. Discovery is next.</Headline>
      <Paragraph>
        {buyerName}, we&apos;ve got your answers for {companyName}. The next
        step is a discovery call — a 60-minute conversation to pressure-test
        what we heard and decide the shape of the build.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Intake submitted">{submittedAtFormatted}</InfoBlock>
      <Spacer size="md" />
      <Button href={calendlyUrl}>Book discovery &rarr;</Button>
      <Divider />
      <Paragraph small>
        [WHAT TO EXPECT ON DISCOVERY]
      </Paragraph>
      <Paragraph small>
        — Walk through your current workflow end to end, in your words.
      </Paragraph>
      <Paragraph small>
        — Identify the modules SPEC will build and the ones it won&apos;t.
      </Paragraph>
      <Paragraph small>
        — Confirm the locked subscription multiplier and any module surcharge.
      </Paragraph>
      <Paragraph small>
        [After discovery, we draft scope. You countersign. P2 fires. Build
        begins.]
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecIntakeCompletedCustomer.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  submittedAtFormatted: "May 28, 2026 at 9:42 AM PDT",
  calendlyUrl: "https://calendly.com/jacksonsweet/spec-discovery",
} satisfies SpecIntakeCompletedCustomerProps;

export default SpecIntakeCompletedCustomer;

export const previewProps = SpecIntakeCompletedCustomer.PreviewProps;
