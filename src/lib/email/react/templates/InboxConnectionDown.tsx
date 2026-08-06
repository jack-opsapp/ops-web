// @template-version: 1.1.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";
import {
  getInboxConnectionAlertCopy,
  type InboxConnectionDownReason,
} from "../../inbox-connection-alert-copy";

export type { InboxConnectionDownReason } from "../../inbox-connection-alert-copy";

export interface InboxConnectionDownProps {
  companyName: string;
  inboxAddress: string;
  reason: InboxConnectionDownReason;
  hoursSilent: number;
  reconnectUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function InboxConnectionDown({
  companyName,
  inboxAddress,
  reason,
  hoursSilent,
  reconnectUrl,
  unsubscribeUrl,
  list,
}: InboxConnectionDownProps) {
  const copy = getInboxConnectionAlertCopy({ reason, inboxAddress });
  return (
    <OpsEmailLayout
      preview={copy.preview}
      eyebrow={copy.eyebrow}
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{copy.headline}</Headline>
      <Paragraph>{copy.body}</Paragraph>
      <Spacer size="md" />
      <Button href={reconnectUrl}>{copy.actionLabel} &rarr;</Button>
      <Spacer size="lg" />
      <InfoBlock label="Inbox">{inboxAddress}</InfoBlock>
      <InfoBlock label="Status">{copy.status}</InfoBlock>
      <InfoBlock label="Quiet for">
        {hoursSilent === 1 ? "About an hour" : `About ${hoursSilent} hours`}
      </InfoBlock>
      <InfoBlock label="Company">{companyName}</InfoBlock>
      <Spacer size="md" />
      <Paragraph small>{copy.footer}</Paragraph>
    </OpsEmailLayout>
  );
}

InboxConnectionDown.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  inboxAddress: "canprojack@gmail.com",
  reason: "webhook_expired",
  hoursSilent: 3,
  reconnectUrl: "https://app.opsapp.co/settings?tab=integrations",
} satisfies InboxConnectionDownProps;

export default InboxConnectionDown;

export const previewProps = InboxConnectionDown.PreviewProps;
