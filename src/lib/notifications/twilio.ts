/**
 * OPS Web — Twilio client for outbound SMS.
 *
 * SERVER ONLY. Used by the unified PMF notification sender
 * (`./pmf-send.ts`) and any future SMS-emitting workflow. Twilio SDK is
 * lazily instantiated so that importing this module at build time does
 * not require Twilio env vars to be present.
 */
import 'server-only';
import Twilio from 'twilio';

type TwilioClient = ReturnType<typeof Twilio>;

/**
 * Hard cap on outbound SMS body length — two 160-char GSM-7 segments.
 * Prevents runaway templates from mail-bombing an operator. Bodies longer
 * than this are truncated with a console warning so the overflow is
 * visible in logs.
 */
const MAX_SMS_LENGTH = 320;

let client: TwilioClient | null = null;

function getClient(): TwilioClient {
  if (client) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('Missing TWILIO_ACCOUNT_SID and/or TWILIO_AUTH_TOKEN');
  }
  client = Twilio(sid, token);
  return client;
}

/**
 * Send a single SMS via the configured Twilio phone number. Body is
 * truncated at `MAX_SMS_LENGTH` characters (two SMS segments) so we never
 * accidentally mail-bomb an operator with a runaway template.
 */
export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('TWILIO_PHONE_NUMBER missing');
  if (body.length > MAX_SMS_LENGTH) {
    console.warn(
      '[twilio] SMS body truncated from %d to %d chars',
      body.length,
      MAX_SMS_LENGTH
    );
  }
  const message = await getClient().messages.create({
    to,
    from,
    body: body.slice(0, MAX_SMS_LENGTH),
  });
  return { sid: message.sid };
}
