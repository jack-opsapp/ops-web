/**
 * OPS Web - Twilio SMS Service
 *
 * Sends SMS messages via Twilio. Server-side only.
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER env vars.
 */

import twilio from "twilio";

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Missing Twilio credentials");
  return twilio(accountSid, authToken);
}

function getFromNumber(): string {
  const num = process.env.TWILIO_FROM_NUMBER;
  if (!num) throw new Error("Missing TWILIO_FROM_NUMBER");
  return num;
}

export async function sendTeamInviteSMS(params: {
  phone: string;
  companyName: string;
  joinUrl: string;
}): Promise<void> {
  const client = getClient();

  await client.messages.create({
    to: params.phone,
    from: getFromNumber(),
    body: `You've been invited to join ${params.companyName} on OPS. Tap to join: ${params.joinUrl}`,
  });
}
