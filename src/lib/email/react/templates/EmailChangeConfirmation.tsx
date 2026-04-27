import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, InfoBlock, Spacer, Button } from "../primitives";
import { GATE } from "../../senders";

interface EmailChangeConfirmationProps {
  newEmail: string;
  oldEmail: string;
  recoveryLink: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function EmailChangeConfirmation({
  newEmail,
  oldEmail,
  recoveryLink,
  unsubscribeUrl,
  list,
}: EmailChangeConfirmationProps) {
  return (
    <OpsEmailLayout
      preview={`Your OPS sign-in is now ${newEmail}`}
      eyebrow="Email changed"
      senderAddress={GATE.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Email changed.</Headline>
      <Paragraph>
        Your OPS sign-in is now {newEmail}. If that wasn&apos;t you, tap
        below to revert to {oldEmail}.
      </Paragraph>
      <Spacer size="md" />
      <InfoBlock label="New sign-in">{newEmail}</InfoBlock>
      <InfoBlock label="Previous">{oldEmail}</InfoBlock>
      <Spacer size="md" />
      <Button href={recoveryLink}>Revert email &rarr;</Button>
    </OpsEmailLayout>
  );
}

EmailChangeConfirmation.PreviewProps = {
  newEmail: "new@example.com",
  oldEmail: "old@example.com",
  recoveryLink: "https://app.opsapp.co/auth/action?mode=recoverEmail&oobCode=preview",
} satisfies EmailChangeConfirmationProps;

export default EmailChangeConfirmation;
