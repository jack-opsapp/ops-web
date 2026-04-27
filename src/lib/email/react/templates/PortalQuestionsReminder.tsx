import * as React from "react";
import { PortalEmailLayout } from "../layouts/PortalEmailLayout";
import { Headline, Paragraph, Button, Spacer } from "../primitives";

interface PortalQuestionsReminderProps {
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl: string | null;
  unsubscribeUrl?: string;
  list?: string;
  companyPhysicalAddress?: string | null;
}

export function PortalQuestionsReminder({
  companyName,
  portalUrl,
  accentColor,
  logoUrl,
  unsubscribeUrl,
  list,
  companyPhysicalAddress,
}: PortalQuestionsReminderProps) {
  return (
    <PortalEmailLayout
      preview={`${companyName} needs a few answers`}
      eyebrow="Quick questions"
      companyName={companyName}
      companyPhysicalAddress={companyPhysicalAddress}
      logoUrl={logoUrl}
      accentColor={accentColor}
      senderAddress="noreply@opsapp.co"
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{companyName} needs a few answers.</Headline>
      <Paragraph>
        We can&apos;t move forward on your job until we hear back. Takes
        less than a minute.
      </Paragraph>
      <Spacer size="md" />
      <Button href={portalUrl} accentColor={accentColor}>
        Answer questions &rarr;
      </Button>
    </PortalEmailLayout>
  );
}

PortalQuestionsReminder.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  portalUrl: "https://app.opsapp.co/portal/preview",
  accentColor: "#597794",
  logoUrl: null,
} satisfies PortalQuestionsReminderProps;

export default PortalQuestionsReminder;
