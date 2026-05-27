// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface SpecSupportWindowOpenProps {
  buyerName: string;
  companyName: string;
  tier: "Setup" | "Build" | "Enterprise";
  supportWindowDaysFormatted: string;
  walkthroughDateFormatted: string;
  supportEndsFormatted: string;
  guaranteeEndsFormatted: string;
  ticketUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function SpecSupportWindowOpen({
  buyerName,
  companyName,
  tier,
  supportWindowDaysFormatted,
  walkthroughDateFormatted,
  supportEndsFormatted,
  guaranteeEndsFormatted,
  ticketUrl,
  unsubscribeUrl,
  list,
}: SpecSupportWindowOpenProps) {
  return (
    <OpsEmailLayout
      preview="Support window is open. Guarantee Period clock is running."
      eyebrow="// SPEC :: SUPPORT WINDOW OPEN"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Support window is live. Use it.</Headline>
      <Paragraph>
        {buyerName}, with the {companyName} SPEC {tier} delivery walkthrough
        complete, your {supportWindowDaysFormatted}-day Support Window is now
        open. Use it for anything that breaks or doesn&apos;t match the scope
        document.
      </Paragraph>
      <Spacer size="sm" />
      <InfoBlock label="Walkthrough date">{walkthroughDateFormatted}</InfoBlock>
      <InfoBlock label="Support window ends">{supportEndsFormatted}</InfoBlock>
      <InfoBlock label="30-day Guarantee window ends">{guaranteeEndsFormatted}</InfoBlock>
      <Spacer size="md" />
      <Button href={ticketUrl}>File a support ticket &rarr;</Button>
      <Divider />
      <Paragraph small>
        [WHAT&apos;S COVERED]
      </Paragraph>
      <Paragraph small>
        — Critical defects: anything that breaks a core workflow or blocks
        daily operation. Fixed at no charge, regardless of cause. Same-day
        response targeted; 48-hour resolution targeted.
      </Paragraph>
      <Paragraph small>
        — High-severity defects: degrade but don&apos;t block. Fixed at no
        charge when they violate an acceptance criterion in your scope
        document. 3-business-day resolution targeted.
      </Paragraph>
      <Paragraph small>
        — Cosmetic and enhancement requests: billable Change Orders per SPEC
        Terms of Service Section 7.
      </Paragraph>
      <Divider />
      <Paragraph small>
        [GUARANTEE PERIOD]
      </Paragraph>
      <Paragraph small>
        The 30-day Guarantee Refund window is running in parallel until{" "}
        {guaranteeEndsFormatted}. If you decide the engagement didn&apos;t
        deliver what you needed, request the refund by written notice — no
        defect proof required, no cure period.
      </Paragraph>
      <Paragraph small>
        After the Support Window closes, ongoing maintenance moves to the
        optional Retainer or to ad-hoc Change Orders. We&apos;ll send a
        separate retainer offer before the window closes.
      </Paragraph>
    </OpsEmailLayout>
  );
}

SpecSupportWindowOpen.PreviewProps = {
  buyerName: "Marcus",
  companyName: "CanPro Deck and Rail",
  tier: "Build",
  supportWindowDaysFormatted: "60",
  walkthroughDateFormatted: "Jul 30, 2026",
  supportEndsFormatted: "Sep 28, 2026",
  guaranteeEndsFormatted: "Aug 29, 2026",
  ticketUrl: "https://app.opsapp.co/admin/spec/tickets/preview",
} satisfies SpecSupportWindowOpenProps;

export default SpecSupportWindowOpen;

export const previewProps = SpecSupportWindowOpen.PreviewProps;
