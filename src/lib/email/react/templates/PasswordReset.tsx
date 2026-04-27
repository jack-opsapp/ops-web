import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { GATE } from "../../senders";

interface PasswordResetProps {
  resetLink: string;
}

export function PasswordReset({ resetLink }: PasswordResetProps) {
  return (
    <OpsEmailLayout
      preview="Reset your OPS password — link valid for 60 minutes"
      eyebrow="Secure password reset"
      senderAddress={GATE.email}
    >
      <Headline>Set a new password.</Headline>
      <Paragraph>
        Someone asked to reset your OPS password. If that was you, tap below.
        This link is good for 60 minutes.
      </Paragraph>
      <Spacer size="md" />
      <Button href={resetLink}>Set password →</Button>
      <Spacer size="lg" />
      <Divider spacing="sm" />
      <Paragraph small>
        Didn&apos;t ask? Ignore this. Your password stays put.
      </Paragraph>
    </OpsEmailLayout>
  );
}

PasswordReset.PreviewProps = {
  resetLink: "https://app.opsapp.co/auth/action?mode=resetPassword&oobCode=preview",
} satisfies PasswordResetProps;

export default PasswordReset;
