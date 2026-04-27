import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer } from "../primitives";
import { GATE } from "../../senders";

interface EmailVerificationProps {
  verifyLink: string;
}

export function EmailVerification({ verifyLink }: EmailVerificationProps) {
  return (
    <OpsEmailLayout
      preview="Confirm your email on OPS"
      eyebrow="Email verification"
      senderAddress={GATE.email}
    >
      <Headline>Confirm it&apos;s you.</Headline>
      <Paragraph>
        We need to know this email is actually yours. One tap and you&apos;re
        done. Link&apos;s good for 60 minutes.
      </Paragraph>
      <Spacer size="md" />
      <Button href={verifyLink}>Verify email &rarr;</Button>
    </OpsEmailLayout>
  );
}

EmailVerification.PreviewProps = {
  verifyLink: "https://app.opsapp.co/auth/action?mode=verifyEmail&oobCode=preview",
} satisfies EmailVerificationProps;

export default EmailVerification;
