// @template-version: 1.0.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";

interface BetaAccessRequestProps {
  userName: string;
  userEmail: string;
  companyName: string;
  companyPhone: string;
  companyAddress: string;
  companySize: string;
  companyIndustries: string[];
  featureTitle: string;
  featureDescription: string;
  adminUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function BetaAccessRequest(p: BetaAccessRequestProps) {
  return (
    <OpsEmailLayout
      preview={`Beta request: ${p.featureTitle} — ${p.companyName}`}
      eyebrow="Beta request"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={p.unsubscribeUrl}
      list={p.list}
    >
      <Headline>Beta request: {p.featureTitle}</Headline>
      <Paragraph>{p.featureDescription}</Paragraph>
      <Spacer size="md" />
      <InfoBlock label="Requester">
        {p.userName} ({p.userEmail})
      </InfoBlock>
      <InfoBlock label="Company">
        {p.companyName} &middot; {p.companySize} &middot;{" "}
        {p.companyIndustries.join(", ")}
      </InfoBlock>
      <InfoBlock label="Contact">
        {p.companyPhone} &middot; {p.companyAddress}
      </InfoBlock>
      <Spacer size="md" />
      <Button href={p.adminUrl}>Review in admin &rarr;</Button>
    </OpsEmailLayout>
  );
}

BetaAccessRequest.PreviewProps = {
  userName: "Jackson",
  userEmail: "jackson@example.com",
  companyName: "CanPro Deck and Rail",
  companyPhone: "+1 250 555 0100",
  companyAddress: "Victoria, BC",
  companySize: "4 crew",
  companyIndustries: ["Deck & Rail"],
  featureTitle: "Deck Builder",
  featureDescription: "Early access to the in-app deck drawing tool.",
  adminUrl: "https://app.opsapp.co/admin/beta/preview",
} satisfies BetaAccessRequestProps;

export default BetaAccessRequest;

export const previewProps = BetaAccessRequest.PreviewProps;
