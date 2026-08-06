export type InboxConnectionDownReason =
  | "webhook_expired"
  | "webhook_setup_failed"
  | "sync_stale";

interface InboxConnectionAlertCopy {
  eyebrow: string;
  preview: string;
  headline: string;
  body: string;
  status: string;
  actionLabel: string;
  footer: string;
  notificationTitle: string;
  notificationBody: string;
  notificationActionLabel: string;
  reconnectRequired: boolean;
}

export function getInboxConnectionAlertCopy(input: {
  reason: InboxConnectionDownReason;
  inboxAddress: string;
}): InboxConnectionAlertCopy {
  const { reason, inboxAddress } = input;

  if (reason === "sync_stale") {
    return {
      eyebrow: "Inbox // Processing delayed",
      preview: `${inboxAddress} is connected — OPS processing is delayed`,
      headline: "Inbox processing is delayed.",
      body: "Your inbox is still connected. OPS has not processed recent mail. Automatic retry is active. You do not need to reconnect.",
      status: "Processing delayed",
      actionLabel: "Open inbox settings",
      footer: `New mail remains safe in ${inboxAddress} while OPS retries processing. No reconnect is needed.`,
      notificationTitle: "Inbox processing is delayed",
      notificationBody: `${inboxAddress} is still connected. OPS has not processed recent mail. Automatic retry is active.`,
      notificationActionLabel: "CHECK INBOX STATUS",
      reconnectRequired: false,
    };
  }

  if (reason === "webhook_setup_failed") {
    return {
      eyebrow: "Inbox // Connection down",
      preview: `${inboxAddress} has not finished connecting to OPS`,
      headline: "We couldn't finish hooking up your inbox.",
      body: "OPS started the connection, but something blocked the final handshake with your email provider. Until that's sorted, leads coming into your inbox aren't being captured. Reconnect to finish setup.",
      status: "Setup didn't complete",
      actionLabel: "Reconnect inbox",
      footer: `While the connection is down, anything coming into ${inboxAddress} stays in your email and doesn't hit your OPS pipeline. Reconnect to finish setup.`,
      notificationTitle: "Your inbox connection needs attention",
      notificationBody: `${inboxAddress} did not finish connecting. Reconnect to start capturing leads.`,
      notificationActionLabel: "RECONNECT INBOX",
      reconnectRequired: true,
    };
  }

  return {
    eyebrow: "Inbox // Connection down",
    preview: `${inboxAddress} stopped sending leads to OPS — reconnect in 30 seconds`,
    headline: "Your inbox stopped feeding leads to OPS.",
    body: "The connection between your inbox and OPS expired. New emails are landing in your inbox, but they're not making it into your pipeline. Reconnect and OPS picks up where it left off — it takes about thirty seconds.",
    status: "Inbox connection expired",
    actionLabel: "Reconnect inbox",
    footer: `While the connection is down, anything coming into ${inboxAddress} stays in your email and doesn't hit your OPS pipeline. Reconnect and OPS picks up where it left off.`,
    notificationTitle: "Your inbox stopped sending leads to OPS",
    notificationBody: `${inboxAddress} is disconnected. Reconnect to start capturing leads again.`,
    notificationActionLabel: "RECONNECT INBOX",
    reconnectRequired: true,
  };
}
