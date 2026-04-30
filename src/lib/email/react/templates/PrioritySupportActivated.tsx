import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";

export interface PrioritySupportActivatedProps {
  companyName: string;
  period: "monthly" | "annual";
  startedAtDisplay: string;
  contactEmail: string;
  manageUrl: string;
}

export function PrioritySupportActivated(p: PrioritySupportActivatedProps) {
  return (
    <OpsEmailLayout
      preview={`Priority Support active for ${p.companyName}`}
      eyebrow="Priority support // Active"
      senderAddress={DISPATCH.email}
    >
      <Headline>You&apos;re at the front of the line.</Headline>
      <Paragraph>
        Priority Support is live for {p.companyName}. Email{" "}
        {p.contactEmail} from inside OPS or hit reply on this message and the
        founder picks it up first.
      </Paragraph>
      <Spacer size="md" />
      <InfoBlock label="Plan">
        Priority Support &middot;{" "}
        {p.period === "annual" ? "Annual billing" : "Monthly billing"}
      </InfoBlock>
      <InfoBlock label="Active since">{p.startedAtDisplay}</InfoBlock>
      <InfoBlock label="How to use it">
        Use the &ldquo;Contact priority support&rdquo; button on the
        Subscription tab. Your email lands in our priority queue with company
        + plan attached.
      </InfoBlock>
      <Spacer size="md" />
      <Button href={p.manageUrl}>Open subscription settings &rarr;</Button>
    </OpsEmailLayout>
  );
}

PrioritySupportActivated.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  period: "monthly",
  startedAtDisplay: "Apr 29, 2026",
  contactEmail: "jack@opsapp.co",
  manageUrl: "https://app.opsapp.co/settings?tab=subscription",
} satisfies PrioritySupportActivatedProps;

export default PrioritySupportActivated;
