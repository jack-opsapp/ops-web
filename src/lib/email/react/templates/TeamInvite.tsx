import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import {
  Headline,
  Paragraph,
  Button,
  Spacer,
  InfoBlock,
  Divider,
} from "../primitives";
import { DISPATCH } from "../../senders";

interface TeamInviteProps {
  companyName: string;
  joinUrl: string;
  inviterName: string;
  inviterEmail: string;
  companyCode: string;
  roleName: string | null;
  unsubscribeUrl?: string;
  list?: string;
}

export function TeamInvite({
  companyName,
  joinUrl,
  inviterName,
  inviterEmail,
  companyCode,
  roleName,
  unsubscribeUrl,
  list,
}: TeamInviteProps) {
  return (
    <OpsEmailLayout
      preview={`${inviterName} invited you to join ${companyName} on OPS`}
      eyebrow="Team invite"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{inviterName} wants you on the crew.</Headline>
      <Paragraph>
        They&apos;re running {companyName} on OPS &mdash; one app that puts
        every job in front of your whole crew without the text-message chaos.
        Takes 2 minutes to set up.
      </Paragraph>
      <Spacer size="md" />
      <Button href={joinUrl}>Join {companyName} &rarr;</Button>
      <Spacer size="lg" />
      <InfoBlock label="Company code">{companyCode}</InfoBlock>
      {roleName ? (
        <InfoBlock label="Your role">{roleName}</InfoBlock>
      ) : null}
      <Divider spacing="sm" />
      <Paragraph small>
        Invited by {inviterName} ({inviterEmail}). If this came out of
        nowhere, ignore it &mdash; nothing changes on your end.
      </Paragraph>
    </OpsEmailLayout>
  );
}

TeamInvite.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  joinUrl: "https://app.opsapp.co/join/preview",
  inviterName: "Jackson",
  inviterEmail: "jackson@canprodeck.com",
  companyCode: "CANPRO-01",
  roleName: "Field Lead",
} satisfies TeamInviteProps;

export default TeamInvite;
