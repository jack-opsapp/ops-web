import * as React from "react";
import { PortalEmailLayout } from "../layouts/PortalEmailLayout";
import { Headline, Paragraph, Button, Spacer } from "../primitives";

interface PortalMagicLinkProps {
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl: string | null;
}

export function PortalMagicLink({
  companyName,
  portalUrl,
  accentColor,
  logoUrl,
}: PortalMagicLinkProps) {
  return (
    <PortalEmailLayout
      preview={`Access your ${companyName} portal`}
      eyebrow="Your portal"
      companyName={companyName}
      logoUrl={logoUrl}
      accentColor={accentColor}
      senderAddress="noreply@opsapp.co"
    >
      <Headline>Your {companyName} portal.</Headline>
      <Paragraph>
        Tap below to check on your job, pay an invoice, or send us a
        question. Link&apos;s yours for 24 hours.
      </Paragraph>
      <Spacer size="md" />
      <Button href={portalUrl} accentColor={accentColor}>
        Open portal &rarr;
      </Button>
    </PortalEmailLayout>
  );
}

PortalMagicLink.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  portalUrl: "https://app.opsapp.co/portal/preview",
  accentColor: "#597794",
  logoUrl: null,
} satisfies PortalMagicLinkProps;

export default PortalMagicLink;
