/**
 * OPS Email Sender Identities
 *
 * Four buckets, each with a clear job:
 * - DISPATCH  — product, team, beta, trial, billing, ads briefing
 * - GATE      — security, auth, password, email verification
 * - FIELD_NOTES — newsletter, long-form content
 * - PORTAL    — whitelabel portal emails (uses env SENDGRID_FROM_EMAIL
 *                with per-company `name` override)
 *
 * Before flipping any sendgrid.ts function to use these, the addresses
 * must be verified in SendGrid + SPF/DKIM/DMARC aligned on opsapp.co.
 * See OPS-Web/docs/email/sendgrid-senders-setup.md.
 */

export interface Sender {
  email: string;
  name: string;
}

export const DISPATCH: Sender = {
  email: "dispatch@opsapp.co",
  name: "OPS Dispatch",
};

export const GATE: Sender = {
  email: "gate@opsapp.co",
  name: "OPS Gate",
};

export const FIELD_NOTES: Sender = {
  email: "field@opsapp.co",
  name: "OPS Field Notes",
};

/**
 * Portal whitelabel bucket — address is fixed, name is the company name
 * passed by the caller. The function building the send uses this helper
 * to construct the From object.
 */
export function portalSender(companyName: string): Sender {
  return {
    email: process.env.SENDGRID_FROM_EMAIL ?? "noreply@opsapp.co",
    name: companyName,
  };
}
