// @template-version: 1.1.0
import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";

export type InboxConnectionDownReason =
  | "webhook_expired"
  | "webhook_setup_failed"
  | "sync_stale";

export interface InboxConnectionDownProps {
  companyName: string;
  inboxAddress: string;
  reason: InboxConnectionDownReason;
  hoursSilent: number;
  reconnectUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

const REASON_COPY: Record<
  InboxConnectionDownReason,
  { headline: string; body: string; status: string }
> = {
  webhook_expired: {
    headline: "Your inbox stopped feeding leads to OPS.",
    body: "The connection between your inbox and OPS expired. New emails are landing in your inbox, but they're not making it into your pipeline. Reconnect and OPS picks up where it left off — it takes about thirty seconds.",
    status: "Inbox connection expired",
  },
  webhook_setup_failed: {
    headline: "We couldn't finish hooking up your inbox.",
    body: "OPS started the connection, but something blocked the final handshake with your email provider. Until that's sorted, leads coming into your inbox aren't being captured. Reconnect to finish setup.",
    status: "Setup didn't complete",
  },
  sync_stale: {
    headline: "OPS lost the line to your inbox.",
    body: "OPS hasn't been able to pull from your inbox in a while. New emails may be landing there without making it into your pipeline. Reconnect and OPS picks up where it left off — it takes about thirty seconds.",
    status: "No recent sync activity",
  },
};

export function InboxConnectionDown({
  companyName,
  inboxAddress,
  reason,
  hoursSilent,
  reconnectUrl,
  unsubscribeUrl,
  list,
}: InboxConnectionDownProps) {
  const copy = REASON_COPY[reason];
  return (
    <OpsEmailLayout
      preview={`${inboxAddress} stopped sending leads to OPS — reconnect in 30 seconds`}
      eyebrow="Inbox // Connection down"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>{copy.headline}</Headline>
      <Paragraph>{copy.body}</Paragraph>
      <Spacer size="md" />
      <Button href={reconnectUrl}>Reconnect inbox &rarr;</Button>
      <Spacer size="lg" />
      <InfoBlock label="Inbox">{inboxAddress}</InfoBlock>
      <InfoBlock label="Status">{copy.status}</InfoBlock>
      <InfoBlock label="Quiet for">
        {hoursSilent === 1 ? "About an hour" : `About ${hoursSilent} hours`}
      </InfoBlock>
      <InfoBlock label="Company">{companyName}</InfoBlock>
      <Spacer size="md" />
      <Paragraph small>
        While the connection is down, anything coming into{" "}
        {inboxAddress} stays in your email and doesn&rsquo;t hit your OPS
        pipeline. We&rsquo;ll keep checking and send a reminder if it&rsquo;s
        still down &mdash; or you can mute these from Settings &rarr;
        Integrations.
      </Paragraph>
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
