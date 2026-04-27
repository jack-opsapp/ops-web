import * as React from "react";
import { PortalEmailLayout } from "../layouts/PortalEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";

interface PortalEstimateReadyProps {
  companyName: string;
  estimateNumber: string;
  portalUrl: string;
  accentColor: string;
  logoUrl: string | null;
}

export function PortalEstimateReady({
  companyName,
  estimateNumber,
  portalUrl,
  accentColor,
  logoUrl,
}: PortalEstimateReadyProps) {
  return (
    <PortalEmailLayout
      preview={`Estimate ${estimateNumber} from ${companyName}`}
      eyebrow={`Estimate ${estimateNumber}`}
      companyName={companyName}
      logoUrl={logoUrl}
      accentColor={accentColor}
      senderAddress="noreply@opsapp.co"
    >
      <Headline>Your estimate&apos;s ready.</Headline>
      <Paragraph>
        {companyName} put together an estimate for you. Tap below to review
        the work and pricing.
      </Paragraph>
      <InfoBlock label="Estimate">#{estimateNumber}</InfoBlock>
      <Spacer size="md" />
      <Button href={portalUrl} accentColor={accentColor}>
        Review estimate &rarr;
      </Button>
    </PortalEmailLayout>
  );
}

PortalEstimateReady.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  estimateNumber: "2026-001",
  portalUrl: "https://app.opsapp.co/portal/preview",
  accentColor: "#597794",
  logoUrl: null,
} satisfies PortalEstimateReadyProps;

export default PortalEstimateReady;
