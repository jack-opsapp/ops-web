import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";

interface BetaAccessDecisionProps {
  userName: string;
  featureTitle: string;
  approved: boolean;
  adminNotes: string | null;
}

export function BetaAccessDecision({
  userName,
  featureTitle,
  approved,
  adminNotes,
}: BetaAccessDecisionProps) {
  return (
    <OpsEmailLayout
      preview={
        approved
          ? `You're in — ${featureTitle}`
          : `Beta decision — ${featureTitle}`
      }
      eyebrow={approved ? "Beta approved" : "Beta decision"}
      senderAddress={DISPATCH.email}
    >
      <Headline>
        {approved ? `You're in, ${userName}.` : `About ${featureTitle}.`}
      </Headline>
      <Paragraph>
        {approved
          ? `Your beta access for ${featureTitle} is live. Head back into OPS and you'll see it unlocked on your account.`
          : `We've reviewed your request for ${featureTitle}. We're not opening access right now.`}
      </Paragraph>
      {adminNotes ? (
        <InfoBlock label={approved ? "Notes from the crew" : "Why"}>
          {adminNotes}
        </InfoBlock>
      ) : null}
      <Spacer size="md" />
      <Button href="https://app.opsapp.co">Open OPS &rarr;</Button>
    </OpsEmailLayout>
  );
}

BetaAccessDecision.PreviewProps = {
  userName: "Jackson",
  featureTitle: "Deck Builder",
  approved: true,
  adminNotes: null,
} satisfies BetaAccessDecisionProps;

export default BetaAccessDecision;
