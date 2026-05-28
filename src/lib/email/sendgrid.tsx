/**
 * OPS Web - SendGrid Email Service
 *
 * Sends all OPS transactional and marketing email. Every template is a
 * React Email component rendered at send time via `@react-email/render`.
 * Sender identities live in `./senders.ts` — four buckets:
 *
 *   DISPATCH    — product / team / beta / trial / ads briefing
 *   GATE        — security / auth / password / email verification
 *   FIELD_NOTES — blog newsletter
 *   portalSender(companyName) — whitelabel portal emails (contractor brand)
 *
 * Uses SENDGRID_API_KEY and SENDGRID_FROM_EMAIL environment variables.
 *
 * CAN-SPAM + CASL compliance (PR 2): every send carries a per-recipient
 * RFC-8058 `List-Unsubscribe` URL signed with HMAC-SHA256, plus the
 * `List-Unsubscribe-Post` header that opts the message into Gmail one-click.
 * The compliance footer (legal name + physical address + unsubscribe link)
 * is rendered by `ComplianceFooter`, which both layouts include.
 */

import * as React from "react";
import sgMail from "@sendgrid/mail";
import { render } from "@react-email/render";

// React Email templates
import { PasswordReset } from "./react/templates/PasswordReset";
import { EmailVerification } from "./react/templates/EmailVerification";
import { EmailChangeConfirmation } from "./react/templates/EmailChangeConfirmation";
import { TeamInvite } from "./react/templates/TeamInvite";
import { RoleNeeded } from "./react/templates/RoleNeeded";
import { BetaAccessRequest } from "./react/templates/BetaAccessRequest";
import { BetaAccessDecision } from "./react/templates/BetaAccessDecision";
import { TrialExpiryWarning } from "./react/templates/TrialExpiryWarning";
import { TrialExpiryDiscount } from "./react/templates/TrialExpiryDiscount";
import { TrialExpiryReengagement } from "./react/templates/TrialExpiryReengagement";
import { ProductUpdate } from "./react/templates/ProductUpdate";
import { FeatureAnnouncement } from "./react/templates/FeatureAnnouncement";
import { Reengagement } from "./react/templates/Reengagement";
import {
  InboxConnectionDown,
  type InboxConnectionDownReason,
} from "./react/templates/InboxConnectionDown";
import { AdsBriefing } from "./react/templates/AdsBriefing";
import { BlogNewsletter } from "./react/templates/BlogNewsletter";
import {
  FieldNotesNewsletter,
  type NewsletterItem,
} from "./react/templates/FieldNotesNewsletter";
import { PortalMagicLink } from "./react/templates/PortalMagicLink";
import { PortalEstimateReady } from "./react/templates/PortalEstimateReady";
import { PortalInvoiceReady } from "./react/templates/PortalInvoiceReady";
import { PortalQuestionsReminder } from "./react/templates/PortalQuestionsReminder";
import { DataSetupRequest } from "./react/templates/DataSetupRequest";
import { PrioritySupportActivated } from "./react/templates/PrioritySupportActivated";
import { Day0Welcome } from "./react/templates/onboarding/Day0Welcome";
import { Day3Inbox } from "./react/templates/onboarding/Day3Inbox";
import { Day8Estimates } from "./react/templates/onboarding/Day8Estimates";
import { Day14Quiet } from "./react/templates/onboarding/Day14Quiet";
import { Day14Active } from "./react/templates/onboarding/Day14Active";
import { LostYou } from "./react/templates/onboarding/LostYou";
import { Day1NoProject } from "./react/templates/onboarding/Day1NoProject";
import { Day1HasProject } from "./react/templates/onboarding/Day1HasProject";
import { Day4NoNotification } from "./react/templates/onboarding/Day4NoNotification";
import { Day4HasNotification } from "./react/templates/onboarding/Day4HasNotification";

import { DISPATCH, GATE, FIELD_NOTES, JACK, portalSender, type Sender } from "./senders";
import type { AdBriefing } from "@/lib/admin/briefing-types";
import { isSuppressed, filterSuppressed } from "./suppressions";
import { getActivePauseScope } from "./pause";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { buildUnsubscribeUrl } from "./unsubscribe-token";
import { KIND_TO_LIST, OPS_SUPPORT_EMAIL } from "./constants";

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("Missing SENDGRID_API_KEY");
  sgMail.setApiKey(apiKey);
  initialized = true;
}

function getPortalFromEmail(): string {
  return process.env.SENDGRID_FROM_EMAIL ?? "noreply@opsapp.co";
}

/**
 * Build the per-recipient `List-Unsubscribe` URL plus the SMTP headers
 * required by RFC 2369 + RFC 8058. Caller passes the email kind; we look
 * up the canonical list value from `KIND_TO_LIST` so transactional and
 * marketing emails route to the right `email_suppressions.list`.
 */
function buildComplianceHeaders(opts: { email: string; kind: string }): {
  list: string;
  unsubscribeUrl: string;
  headers: Record<string, string>;
} {
  const list = KIND_TO_LIST[opts.kind] ?? "global";
  const unsubscribeUrl = buildUnsubscribeUrl({ email: opts.email, list });
  return {
    list,
    unsubscribeUrl,
    headers: {
      // RFC 2369: comma-separated URI references; per RFC 8058 we offer the
      // HTTPS POST endpoint plus a mailto fallback so MUAs that don't
      // implement one-click can still honour the request.
      "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${OPS_SUPPORT_EMAIL}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/**
 * Outcome of a `gatedSend` call. Exposed so the campaign worker can branch
 * on suppression vs. delivery and can persist the SendGrid `messageId` for
 * webhook attribution.
 */
export type GatedSendResult =
  | { status: "sent"; messageId: string | null }
  | { status: "suppression_skipped"; reason: "suppressed" }
  | { status: "paused_skipped"; scope: string };

/**
 * Single-recipient send chokepoint. Every typed sendXxx function below
 * routes through this. Performs the suppression check, dispatches via
 * SendGrid (with compliance headers injected), and writes to email_log.
 * Throws on transport error so the caller sees the failure; never throws
 * on suppression (silent skip).
 */
async function gatedSend(params: {
  to: string;
  from: Sender;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  emailType: string;
  list?: string;
  /**
   * Compliance headers (List-Unsubscribe + List-Unsubscribe-Post). When
   * omitted, gatedSend builds them from `(to, emailType)` itself so a
   * caller can never forget to include them — RFC-8058 is mandatory for
   * every commercial OPS email, regardless of bucket.
   */
  headers?: Record<string, string>;
  userId?: string;
  metadata?: Record<string, unknown>;
  /**
   * Campaign UUID, when this send is part of a marketing/lifecycle campaign.
   * Stored on `email_log.campaign_id` and forwarded to SendGrid as a
   * `customArgs.campaign_id` so inbound webhooks (PR 6) can attribute
   * opens / clicks / bounces back to the originating campaign.
   */
  campaignId?: string | null;
  /**
   * Extra string key/values to merge into SendGrid `customArgs`. Used for
   * webhook attribution beyond email_type / campaign_id / user_id (e.g.
   * onboarding_email_log_id so opens / clicks tie back to the source row).
   * Merged AFTER the built-in args, so callers can override if needed.
   */
  customArgs?: Record<string, string>;
}): Promise<GatedSendResult> {
  ensureInitialized();
  const lower = params.to.trim().toLowerCase();
  if (!lower) throw new Error("gatedSend: empty `to` address");

  const list =
    params.list ?? (KIND_TO_LIST[params.emailType] ?? "global");

  // 1) PAUSE CHECK FIRST — operator killswitch trumps everything, including
  // suppressions. A paused send writes email_log.status='paused_skipped' and
  // never calls SendGrid. Pauses are reversible; suppressions are not, so we
  // want pauses to short-circuit the suppression check.
  const activePause = await getActivePauseScope({
    kind: params.emailType,
    campaignId: params.campaignId ?? null,
  });
  if (activePause) {
    await logEmail({
      emailType: params.emailType,
      recipient: lower,
      subject: params.subject,
      status: "paused_skipped",
      metadata: {
        ...(params.metadata ?? {}),
        list,
        pause_scope: activePause.scope,
        pause_reason: activePause.pauseReason,
      },
      userId: params.userId,
      campaignId: params.campaignId ?? null,
    });
    return { status: "paused_skipped", scope: activePause.scope };
  }

  if (await isSuppressed(lower, list)) {
    await logEmail({
      emailType: params.emailType,
      recipient: lower,
      subject: params.subject,
      status: "suppression_skipped",
      metadata: { ...(params.metadata ?? {}), list },
      userId: params.userId,
      campaignId: params.campaignId ?? null,
    });
    return { status: "suppression_skipped", reason: "suppressed" };
  }

  const headers =
    params.headers ?? buildComplianceHeaders({ email: lower, kind: params.emailType }).headers;

  const customArgs: Record<string, string> = {};
  if (params.campaignId) customArgs.campaign_id = params.campaignId;
  if (params.userId) customArgs.user_id = params.userId;
  customArgs.email_type = params.emailType;
  if (params.customArgs) Object.assign(customArgs, params.customArgs);

  const [response] = await sgMail.send({
    to: params.to,
    from: params.from,
    replyTo: params.replyTo,
    subject: params.subject,
    html: params.html,
    text: params.text,
    headers,
    customArgs: Object.keys(customArgs).length > 0 ? customArgs : undefined,
  });

  // SendGrid returns the message id in the `x-message-id` response header.
  // Capture it so the campaign worker can write it onto email_jobs.sg_message_id.
  const responseHeaders = (response as { headers?: Record<string, string> })
    .headers;
  const messageId =
    typeof responseHeaders?.["x-message-id"] === "string"
      ? responseHeaders["x-message-id"]
      : null;

  await logEmail({
    emailType: params.emailType,
    recipient: lower,
    subject: params.subject,
    status: "sent",
    metadata: { ...(params.metadata ?? {}), list, from: params.from.email },
    userId: params.userId,
    campaignId: params.campaignId ?? null,
    sgMessageId: messageId,
  });

  return { status: "sent", messageId };
}

/**
 * Append a row to email_log. Never throws — logging failures are emitted
 * to console.error and swallowed so they don't break the send.
 */
async function logEmail(params: {
  emailType: string;
  recipient: string;
  subject: string;
  status: "sent" | "failed" | "suppression_skipped" | "paused_skipped";
  metadata?: Record<string, unknown>;
  userId?: string;
  errorMessage?: string;
  campaignId?: string | null;
  sgMessageId?: string | null;
}): Promise<void> {
  try {
    const db = getServiceRoleClient();
    const metadata: Record<string, unknown> = { ...(params.metadata ?? {}) };
    if (params.sgMessageId) metadata.sg_message_id = params.sgMessageId;
    const { error } = await db.from("email_log").insert({
      email_type: params.emailType,
      recipient_email: params.recipient,
      subject: params.subject,
      status: params.status,
      error_message: params.errorMessage ?? null,
      metadata,
      user_id: params.userId ?? null,
      campaign_id: params.campaignId ?? null,
    });
    if (error) console.error("[email_log] insert failed:", error.message);
  } catch (e) {
    console.error("[email_log] insert threw:", e);
  }
}

// ─── Portal whitelabel ─────────────────────────────────────────────────────

export async function sendMagicLink(params: {
  email: string;
  token: string;
  companyName: string;
  accentColor: string;
  logoUrl?: string | null;
  /** Customer's CASL/CAN-SPAM postal address (Settings → Company). */
  companyPhysicalAddress?: string | null;
}): Promise<void> {
  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${params.token}`;
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "portal_magic_link",
  });
  const html = await render(
    <PortalMagicLink
      companyName={params.companyName}
      portalUrl={portalUrl}
      accentColor={params.accentColor}
      logoUrl={params.logoUrl ?? null}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
      companyPhysicalAddress={params.companyPhysicalAddress ?? null}
    />,
  );

  await gatedSend({
    to: params.email,
    from: portalSender(params.companyName),
    replyTo: getPortalFromEmail(),
    subject: `Access your ${params.companyName} portal`,
    html,
    emailType: "portal_magic_link",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName },
  });
}

export async function sendEstimateReady(params: {
  email: string;
  estimateNumber: string;
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl?: string | null;
  companyPhysicalAddress?: string | null;
}): Promise<void> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "portal_estimate_ready",
  });
  const html = await render(
    <PortalEstimateReady
      companyName={params.companyName}
      estimateNumber={params.estimateNumber}
      portalUrl={params.portalUrl}
      accentColor={params.accentColor}
      logoUrl={params.logoUrl ?? null}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
      companyPhysicalAddress={params.companyPhysicalAddress ?? null}
    />,
  );

  await gatedSend({
    to: params.email,
    from: portalSender(params.companyName),
    replyTo: getPortalFromEmail(),
    subject: `Estimate #${params.estimateNumber} from ${params.companyName}`,
    html,
    emailType: "portal_estimate_ready",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, estimateNumber: params.estimateNumber },
  });
}

export async function sendQuestionsReminder(params: {
  email: string;
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl?: string | null;
  companyPhysicalAddress?: string | null;
}): Promise<void> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "portal_questions_reminder",
  });
  const html = await render(
    <PortalQuestionsReminder
      companyName={params.companyName}
      portalUrl={params.portalUrl}
      accentColor={params.accentColor}
      logoUrl={params.logoUrl ?? null}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
      companyPhysicalAddress={params.companyPhysicalAddress ?? null}
    />,
  );

  await gatedSend({
    to: params.email,
    from: portalSender(params.companyName),
    replyTo: getPortalFromEmail(),
    subject: `${params.companyName} needs a few answers from you`,
    html,
    emailType: "portal_questions_reminder",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName },
  });
}

export async function sendInvoiceReady(params: {
  email: string;
  invoiceNumber: string;
  amount: string;
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl?: string | null;
  companyPhysicalAddress?: string | null;
}): Promise<void> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "portal_invoice_ready",
  });
  const html = await render(
    <PortalInvoiceReady
      companyName={params.companyName}
      invoiceNumber={params.invoiceNumber}
      amount={params.amount}
      portalUrl={params.portalUrl}
      accentColor={params.accentColor}
      logoUrl={params.logoUrl ?? null}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
      companyPhysicalAddress={params.companyPhysicalAddress ?? null}
    />,
  );

  await gatedSend({
    to: params.email,
    from: portalSender(params.companyName),
    replyTo: getPortalFromEmail(),
    subject: `Invoice #${params.invoiceNumber} from ${params.companyName} — ${params.amount}`,
    html,
    emailType: "portal_invoice_ready",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, invoiceNumber: params.invoiceNumber, amount: params.amount },
  });
}

// ─── OPS Dispatch ──────────────────────────────────────────────────────────

export async function sendTeamInvite(params: {
  email: string;
  companyName: string;
  joinUrl: string;
  /** @deprecated retained for backward compat; no longer used */
  accentColor?: string;
  /** @deprecated retained for backward compat; no longer used */
  logoUrl?: string | null;
  inviterName: string;
  inviterEmail: string;
  companyCode: string;
  roleName: string | null;
}): Promise<void> {
  const compliance = buildComplianceHeaders({ email: params.email, kind: "team_invite" });
  const html = await render(
    <TeamInvite
      companyName={params.companyName}
      joinUrl={params.joinUrl}
      inviterName={params.inviterName}
      inviterEmail={params.inviterEmail}
      companyCode={params.companyCode}
      roleName={params.roleName}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  await gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `${params.inviterName} invited you to join ${params.companyName} on OPS`,
    html,
    emailType: "team_invite",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, inviterEmail: params.inviterEmail },
  });
}

export async function sendRoleNeeded(params: {
  email: string;
  userName: string;
  companyName: string;
  assignUrl: string;
  /** @deprecated retained for backward compat; no longer used */
  accentColor?: string;
  /** @deprecated retained for backward compat; no longer used */
  logoUrl?: string | null;
}): Promise<void> {
  const compliance = buildComplianceHeaders({ email: params.email, kind: "role_needed" });
  const html = await render(
    <RoleNeeded
      userName={params.userName}
      companyName={params.companyName}
      assignUrl={params.assignUrl}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  await gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `${params.userName} joined ${params.companyName} and needs a role`,
    html,
    emailType: "role_needed",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, joinedUser: params.userName },
  });
}

/**
 * Operator alert when the heartbeat cron detects a real failure in the
 * email-ingest pipeline (expired webhook, failed setup, or stale sync).
 * Goes to the resolved company admin from `dispatch@opsapp.co`. The
 * 'global' list classification + suppression-aware gatedSend keeps it
 * compliant; the cron itself dedupes per-company so we never flood.
 */
export async function sendInboxConnectionDown(params: {
  email: string;
  companyName: string;
  inboxAddress: string;
  reason: InboxConnectionDownReason;
  hoursSilent: number;
  reconnectUrl: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "inbox_connection_down",
  });
  const html = await render(
    <InboxConnectionDown
      companyName={params.companyName}
      inboxAddress={params.inboxAddress}
      reason={params.reason}
      hoursSilent={params.hoursSilent}
      reconnectUrl={params.reconnectUrl}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `Your inbox stopped sending leads to OPS — ${params.companyName}`,
    html,
    emailType: "inbox_connection_down",
    list: compliance.list,
    headers: compliance.headers,
    metadata: {
      companyName: params.companyName,
      inboxAddress: params.inboxAddress,
      reason: params.reason,
      hoursSilent: params.hoursSilent,
    },
  });
}

export async function sendBetaAccessRequest(params: {
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
}): Promise<void> {
  const recipient = "jack@opsapp.co";
  const compliance = buildComplianceHeaders({ email: recipient, kind: "beta_access_request" });
  const html = await render(
    <BetaAccessRequest
      {...params}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  await gatedSend({
    to: recipient,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `Beta Access Request — ${params.featureTitle} — ${params.companyName}`,
    html,
    emailType: "beta_access_request",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, featureTitle: params.featureTitle, requesterEmail: params.userEmail },
  });
}

export async function sendBetaAccessDecision(params: {
  userEmail: string;
  userName: string;
  featureTitle: string;
  approved: boolean;
  adminNotes: string | null;
}): Promise<void> {
  const compliance = buildComplianceHeaders({
    email: params.userEmail,
    kind: "beta_access_decision",
  });
  const html = await render(
    <BetaAccessDecision
      userName={params.userName}
      featureTitle={params.featureTitle}
      approved={params.approved}
      adminNotes={params.adminNotes}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  await gatedSend({
    to: params.userEmail,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: params.approved
      ? `Your OPS Beta Access — Approved`
      : `Your OPS Beta Access Request — ${params.featureTitle}`,
    html,
    emailType: "beta_access_decision",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { featureTitle: params.featureTitle, approved: params.approved },
  });
}

export async function sendAdsBriefing(params: {
  recipientEmails: string[];
  briefing: AdBriefing;
}): Promise<void> {
  const subject = `[OPS Intel] Google Ads Weekly — ${params.briefing.period_start} to ${params.briefing.period_end}`;

  await Promise.all(
    params.recipientEmails.map(async (email) => {
      const compliance = buildComplianceHeaders({ email, kind: "ads_briefing" });
      const html = await render(
        <AdsBriefing
          briefing={params.briefing}
          unsubscribeUrl={compliance.unsubscribeUrl}
          list={compliance.list}
        />,
      );
      return gatedSend({
        to: email,
        from: DISPATCH,
        replyTo: DISPATCH.email,
        subject,
        html,
        emailType: "ads_briefing",
        list: compliance.list,
        headers: compliance.headers,
        metadata: {
          period_start: params.briefing.period_start,
          period_end: params.briefing.period_end,
        },
      });
    }),
  );
}

// ─── Subscription Add-ons (OPS Dispatch) ───────────────────────────────────

/**
 * Internal ops notification that a customer just bought the Data Setup
 * add-on. Sent to ADDON_FULFILLMENT_EMAIL (jack@opsapp.co) so the founder
 * can reach out within 24h. Subject is formatted for inbox triage.
 */
export async function sendDataSetupRequest(params: {
  to: string;
  companyName: string;
  contactEmail: string;
  contactPhone: string | null;
  sourceSoftware: string | null;
  stripePaymentIntentId: string;
  amountDisplay: string;
  purchasedAtDisplay: string;
  adminUrl: string;
}): Promise<void> {
  ensureInitialized();

  const html = await render(
    <DataSetupRequest
      companyName={params.companyName}
      contactEmail={params.contactEmail}
      contactPhone={params.contactPhone}
      sourceSoftware={params.sourceSoftware}
      stripePaymentIntentId={params.stripePaymentIntentId}
      amountDisplay={params.amountDisplay}
      purchasedAtDisplay={params.purchasedAtDisplay}
      adminUrl={params.adminUrl}
    />,
  );

  await sgMail.send({
    to: params.to,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `[OPS Data Setup] ${params.companyName} purchased data setup`,
    html,
  });
}

/**
 * Customer-facing confirmation that Priority Support is now active. Sent
 * to the company billing email after `checkout.session.completed` flips
 * `companies.has_priority_support`.
 */
export async function sendPrioritySupportActivated(params: {
  to: string;
  companyName: string;
  period: "monthly" | "annual";
  startedAtDisplay: string;
  contactEmail: string;
  manageUrl: string;
}): Promise<void> {
  ensureInitialized();

  const html = await render(
    <PrioritySupportActivated
      companyName={params.companyName}
      period={params.period}
      startedAtDisplay={params.startedAtDisplay}
      contactEmail={params.contactEmail}
      manageUrl={params.manageUrl}
    />,
  );

  await sgMail.send({
    to: params.to,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `Priority Support is live for ${params.companyName}`,
    html,
  });
}

// ─── OPS Gate ──────────────────────────────────────────────────────────────

export async function sendPasswordReset(params: {
  email: string;
  resetLink: string;
}): Promise<void> {
  const compliance = buildComplianceHeaders({ email: params.email, kind: "password_reset" });
  const html = await render(
    <PasswordReset
      resetLink={params.resetLink}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  await gatedSend({
    to: params.email,
    from: GATE,
    replyTo: GATE.email,
    subject: "Reset your OPS password",
    html,
    emailType: "password_reset",
    list: compliance.list,
    headers: compliance.headers,
  });
}

export async function sendEmailVerification(params: {
  email: string;
  verifyLink: string;
}): Promise<void> {
  const compliance = buildComplianceHeaders({ email: params.email, kind: "email_verification" });
  const html = await render(
    <EmailVerification
      verifyLink={params.verifyLink}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  await gatedSend({
    to: params.email,
    from: GATE,
    replyTo: GATE.email,
    subject: "Verify your OPS email",
    html,
    emailType: "email_verification",
    list: compliance.list,
    headers: compliance.headers,
  });
}

export async function sendEmailChangeConfirmation(params: {
  toEmail: string;
  newEmail: string;
  oldEmail: string;
  recoveryLink: string;
}): Promise<void> {
  const compliance = buildComplianceHeaders({
    email: params.toEmail,
    kind: "email_change_confirmation",
  });
  const html = await render(
    <EmailChangeConfirmation
      newEmail={params.newEmail}
      oldEmail={params.oldEmail}
      recoveryLink={params.recoveryLink}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  await gatedSend({
    to: params.toEmail,
    from: GATE,
    replyTo: GATE.email,
    subject: "Your OPS sign-in email changed",
    html,
    emailType: "email_change_confirmation",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { newEmail: params.newEmail, oldEmail: params.oldEmail },
  });
}

// ─── Blog Newsletter (OPS Field Notes) ─────────────────────────────────────

export interface BlogNewsletterPost {
  id: string;
  title: string;
  slug: string;
  teaser: string | null;
  thumbnail_url: string | null;
  email_content: string | null;
  content: string;
}

export interface BlogNewsletterRecipient {
  email: string;
  first_name: string | null;
}

export interface BlogNewsletterResult {
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
  results: Array<{ email: string; status: "sent" | "failed" | "skipped"; error?: string }>;
}

const BLOG_NEWSLETTER_BATCH_SIZE = 100;

export async function sendBlogNewsletter(params: {
  post: BlogNewsletterPost;
  recipients: BlogNewsletterRecipient[];
}): Promise<BlogNewsletterResult> {
  // Deduplicate by lowercased email
  const seen = new Set<string>();
  const unique: BlogNewsletterRecipient[] = [];
  for (const r of params.recipients) {
    const lower = (r.email ?? "").toLowerCase().trim();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    unique.push({ email: lower, first_name: r.first_name });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://opsapp.co";
  const postUrl = `${appUrl}/blog/${params.post.slug}`;
  const subject = params.post.title;
  const bodyContent = params.post.email_content ?? params.post.content;

  const aggregate: BlogNewsletterResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    results: [],
  };

  // Bulk-filter suppressed recipients before fan-out so a single SQL query
  // covers the whole list instead of one per recipient.
  const suppressed = await filterSuppressed(
    unique.map((r) => r.email),
    "blog",
  );
  const eligible: BlogNewsletterRecipient[] = [];
  for (const r of unique) {
    if (suppressed.has(r.email)) {
      aggregate.skipped++;
      aggregate.results.push({ email: r.email, status: "skipped" });
    } else {
      eligible.push(r);
    }
  }

  for (let i = 0; i < eligible.length; i += BLOG_NEWSLETTER_BATCH_SIZE) {
    const batch = eligible.slice(i, i + BLOG_NEWSLETTER_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const compliance = buildComplianceHeaders({ email: r.email, kind: "blog_newsletter" });
        const html = await render(
          <BlogNewsletter
            firstName={r.first_name}
            title={params.post.title}
            teaser={params.post.teaser}
            thumbnailUrl={params.post.thumbnail_url}
            emailContent={bodyContent}
            postUrl={postUrl}
            unsubscribeUrl={compliance.unsubscribeUrl}
            list={compliance.list}
          />,
        );
        await gatedSend({
          to: r.email,
          from: FIELD_NOTES,
          replyTo: FIELD_NOTES.email,
          subject,
          html,
          emailType: "blog_newsletter",
          list: compliance.list,
          headers: compliance.headers,
          metadata: { postSlug: params.post.slug, postId: params.post.id },
        });
        return r.email;
      }),
    );

    settled.forEach((outcome, idx) => {
      const email = batch[idx].email;
      if (outcome.status === "fulfilled") {
        aggregate.sent++;
        aggregate.results.push({ email, status: "sent" });
      } else {
        aggregate.failed++;
        const message =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        aggregate.errors.push(`${email}: ${message}`);
        aggregate.results.push({ email, status: "failed", error: message });
      }
    });
  }

  return aggregate;
}

// ─── Field Notes Newsletter (periodic digest — OPS Field Notes) ───────────

export interface FieldNotesIssue {
  issueNumber: number;
  issueDate: string;
  intro: string;
  companyNews: NewsletterItem[];
  industryInsights: NewsletterItem[];
  fullIssueUrl: string;
}

export async function sendFieldNotesNewsletter(params: {
  issue: FieldNotesIssue;
  recipients: BlogNewsletterRecipient[];
}): Promise<BlogNewsletterResult> {
  // Deduplicate by lowercased email
  const seen = new Set<string>();
  const unique: BlogNewsletterRecipient[] = [];
  for (const r of params.recipients) {
    const lower = (r.email ?? "").toLowerCase().trim();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    unique.push({ email: lower, first_name: r.first_name });
  }

  const subject = `Field Notes #${params.issue.issueNumber} — ${params.issue.issueDate}`;

  const aggregate: BlogNewsletterResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    results: [],
  };

  const suppressed = await filterSuppressed(
    unique.map((r) => r.email),
    "field_notes",
  );
  const eligible: BlogNewsletterRecipient[] = [];
  for (const r of unique) {
    if (suppressed.has(r.email)) {
      aggregate.skipped++;
      aggregate.results.push({ email: r.email, status: "skipped" });
    } else {
      eligible.push(r);
    }
  }

  for (let i = 0; i < eligible.length; i += BLOG_NEWSLETTER_BATCH_SIZE) {
    const batch = eligible.slice(i, i + BLOG_NEWSLETTER_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const compliance = buildComplianceHeaders({
          email: r.email,
          kind: "field_notes_newsletter",
        });
        const html = await render(
          <FieldNotesNewsletter
            firstName={r.first_name}
            issueNumber={params.issue.issueNumber}
            issueDate={params.issue.issueDate}
            intro={params.issue.intro}
            companyNews={params.issue.companyNews}
            industryInsights={params.issue.industryInsights}
            fullIssueUrl={params.issue.fullIssueUrl}
            unsubscribeUrl={compliance.unsubscribeUrl}
            list={compliance.list}
          />,
        );
        await gatedSend({
          to: r.email,
          from: FIELD_NOTES,
          replyTo: FIELD_NOTES.email,
          subject,
          html,
          emailType: "field_notes_newsletter",
          list: compliance.list,
          headers: compliance.headers,
          metadata: { issueNumber: params.issue.issueNumber, issueDate: params.issue.issueDate },
        });
        return r.email;
      }),
    );

    settled.forEach((outcome, idx) => {
      const email = batch[idx].email;
      if (outcome.status === "fulfilled") {
        aggregate.sent++;
        aggregate.results.push({ email, status: "sent" });
      } else {
        aggregate.failed++;
        const message =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        aggregate.errors.push(`${email}: ${message}`);
        aggregate.results.push({ email, status: "failed", error: message });
      }
    });
  }

  return aggregate;
}

// ─── Trial Expiry Emails (marketing — OPS Dispatch) ────────────────────────

export async function sendTrialExpiryWarning(params: {
  email: string;
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
  subscribeUrl: string;
  campaignId?: string | null;
  userId?: string | null;
  /** @deprecated retained for backward compat; no longer used */
  accentColor?: string;
  /** @deprecated retained for backward compat; no longer used */
  logoUrl?: string | null;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "trial_expiry_warning",
  });
  const html = await render(
    <TrialExpiryWarning
      companyName={params.companyName}
      daysRemaining={params.daysRemaining}
      trialEndDisplay={params.trialEndDisplay}
      subscribeUrl={params.subscribeUrl}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  const subject =
    params.daysRemaining === 1
      ? "Tomorrow — your OPS trial ends"
      : `${params.daysRemaining} days left on your OPS trial`;

  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject,
    html,
    emailType: "trial_expiry_warning",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, daysRemaining: params.daysRemaining },
    campaignId: params.campaignId ?? null,
    userId: params.userId ?? undefined,
  });
}

export async function sendTrialExpiryDiscount(params: {
  email: string;
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
  promoCode50: string;
  promoCode30: string;
  subscribeUrl: string;
  /** @deprecated retained for backward compat; no longer used */
  accentColor?: string;
  /** @deprecated retained for backward compat; no longer used */
  logoUrl?: string | null;
}): Promise<void> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "trial_expiry_discount",
  });
  const html = await render(
    <TrialExpiryDiscount
      companyName={params.companyName}
      daysRemaining={params.daysRemaining}
      trialEndDisplay={params.trialEndDisplay}
      promoCode50={params.promoCode50}
      promoCode30={params.promoCode30}
      subscribeUrl={params.subscribeUrl}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  await gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `${params.daysRemaining} days left — 50% off or 30% off, your call`,
    html,
    emailType: "trial_expiry_discount",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, daysRemaining: params.daysRemaining },
  });
}

export async function sendTrialExpiryReengagement(params: {
  email: string;
  companyName: string;
  daysSinceExpiry: number;
  promoCode50: string;
  promoCode30: string;
  subscribeUrl: string;
  /** @deprecated retained for backward compat; no longer used */
  accentColor?: string;
  /** @deprecated retained for backward compat; no longer used */
  logoUrl?: string | null;
}): Promise<void> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "trial_expiry_reengagement",
  });
  const html = await render(
    <TrialExpiryReengagement
      companyName={params.companyName}
      daysSinceExpiry={params.daysSinceExpiry}
      promoCode50={params.promoCode50}
      promoCode30={params.promoCode30}
      subscribeUrl={params.subscribeUrl}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  const subject =
    params.daysSinceExpiry >= 30
      ? "Last check-in before we stop"
      : "Still thinking about it?";

  await gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject,
    html,
    emailType: "trial_expiry_reengagement",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, daysSinceExpiry: params.daysSinceExpiry },
  });
}

// ─── Onboarding Drip — Jack-persona (plain text, founder voice) ────────────
//
// All six senders pass `metadata: { onboarding_email_log_id }` into gatedSend
// so the partial-success reconciliation in OnboardingDripService can match
// email_log rows back to onboarding_email_log rows. Per spec §3 v3.1.
// They also pass `customArgs: { onboarding_email_log_id }` so SendGrid event
// webhooks can attribute opens / clicks back to the source onboarding row.

export async function sendOnboardingDay0Welcome(params: {
  email: string;
  firstName: string | null;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_0_welcome",
  });
  const html = await render(
    <Day0Welcome
      firstName={params.firstName}
      unsubscribeUrl={compliance.unsubscribeUrl}
    />,
  );
  return gatedSend({
    to: params.email,
    from: JACK,
    replyTo: JACK.email,
    subject: "quick question",
    html,
    emailType: "onboarding_day_0_welcome",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { onboarding_email_log_id: params.onboardingEmailLogId },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

export async function sendOnboardingDay3Inbox(params: {
  email: string;
  firstName: string | null;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_3_inbox",
  });
  const html = await render(
    <Day3Inbox
      firstName={params.firstName}
      unsubscribeUrl={compliance.unsubscribeUrl}
    />,
  );
  return gatedSend({
    to: params.email,
    from: JACK,
    replyTo: JACK.email,
    subject: "the part of OPS I'm most proud of",
    html,
    emailType: "onboarding_day_3_inbox",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { onboarding_email_log_id: params.onboardingEmailLogId },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

export async function sendOnboardingDay8Estimates(params: {
  email: string;
  firstName: string | null;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_8_estimates",
  });
  const html = await render(
    <Day8Estimates
      firstName={params.firstName}
      unsubscribeUrl={compliance.unsubscribeUrl}
    />,
  );
  return gatedSend({
    to: params.email,
    from: JACK,
    replyTo: JACK.email,
    subject: "how your customers see your estimates",
    html,
    emailType: "onboarding_day_8_estimates",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { onboarding_email_log_id: params.onboardingEmailLogId },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

export async function sendOnboardingDay14Quiet(params: {
  email: string;
  firstName: string | null;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_14_quiet",
  });
  const html = await render(
    <Day14Quiet
      firstName={params.firstName}
      unsubscribeUrl={compliance.unsubscribeUrl}
    />,
  );
  return gatedSend({
    to: params.email,
    from: JACK,
    replyTo: JACK.email,
    subject: "is OPS slotting in or in the way?",
    html,
    emailType: "onboarding_day_14_quiet",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { onboarding_email_log_id: params.onboardingEmailLogId },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

export async function sendOnboardingDay14Active(params: {
  email: string;
  firstName: string | null;
  projectCount: number;
  taskCount: number;
  notificationCount: number;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_14_active",
  });
  const html = await render(
    <Day14Active
      firstName={params.firstName}
      projectCount={params.projectCount}
      taskCount={params.taskCount}
      notificationCount={params.notificationCount}
      unsubscribeUrl={compliance.unsubscribeUrl}
    />,
  );
  return gatedSend({
    to: params.email,
    from: JACK,
    replyTo: JACK.email,
    subject: "you're 14 days in",
    html,
    emailType: "onboarding_day_14_active",
    list: compliance.list,
    headers: compliance.headers,
    metadata: {
      onboarding_email_log_id: params.onboardingEmailLogId,
      projectCount: params.projectCount,
      taskCount: params.taskCount,
      notificationCount: params.notificationCount,
    },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

export async function sendOnboardingLostYou(params: {
  email: string;
  firstName: string | null;
  daysSinceSignup: number;
  daysSinceLastActivity: number;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_lost_you",
  });
  const html = await render(
    <LostYou
      firstName={params.firstName}
      daysSinceSignup={params.daysSinceSignup}
      daysSinceLastActivity={params.daysSinceLastActivity}
      unsubscribeUrl={compliance.unsubscribeUrl}
    />,
  );
  return gatedSend({
    to: params.email,
    from: JACK,
    replyTo: JACK.email,
    subject: "lost you?",
    html,
    emailType: "onboarding_lost_you",
    list: compliance.list,
    headers: compliance.headers,
    metadata: {
      onboarding_email_log_id: params.onboardingEmailLogId,
      daysSinceSignup: params.daysSinceSignup,
      daysSinceLastActivity: params.daysSinceLastActivity,
    },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

// ─── Onboarding Drip — Dispatch-persona (tactical HTML, OPS voice) ─────────
//
// Day 1 and Day 4 branches send `from: DISPATCH` (the tactical brand voice)
// but `replyTo: JACK.email` so any operator reply lands in Jack's inbox.
// All four pass metadata + customArgs.onboarding_email_log_id for
// reconciliation + webhook attribution. Per spec §3 v3.1.

export async function sendOnboardingDay1NoProject(params: {
  email: string;
  ctaUrl: string;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_1_no_project",
  });
  const html = await render(
    <Day1NoProject ctaUrl={params.ctaUrl} unsubscribeUrl={compliance.unsubscribeUrl} />,
  );
  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: JACK.email,
    subject: "the move that gets OPS working",
    html,
    emailType: "onboarding_day_1_no_project",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { onboarding_email_log_id: params.onboardingEmailLogId },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

export async function sendOnboardingDay1HasProject(params: {
  email: string;
  projectCount: number;
  ctaUrl: string;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_1_has_project",
  });
  const html = await render(
    <Day1HasProject
      projectCount={params.projectCount}
      ctaUrl={params.ctaUrl}
      unsubscribeUrl={compliance.unsubscribeUrl}
    />,
  );
  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: JACK.email,
    subject: "you're moving",
    html,
    emailType: "onboarding_day_1_has_project",
    list: compliance.list,
    headers: compliance.headers,
    metadata: {
      onboarding_email_log_id: params.onboardingEmailLogId,
      projectCount: params.projectCount,
    },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

export async function sendOnboardingDay4NoNotification(params: {
  email: string;
  ctaUrl: string;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_4_no_notification",
  });
  const html = await render(
    <Day4NoNotification ctaUrl={params.ctaUrl} unsubscribeUrl={compliance.unsubscribeUrl} />,
  );
  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: JACK.email,
    subject: "the notification you're working toward",
    html,
    emailType: "onboarding_day_4_no_notification",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { onboarding_email_log_id: params.onboardingEmailLogId },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

export async function sendOnboardingDay4HasNotification(params: {
  email: string;
  ctaUrl: string;
  onboardingEmailLogId: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "onboarding_day_4_has_notification",
  });
  const html = await render(
    <Day4HasNotification ctaUrl={params.ctaUrl} unsubscribeUrl={compliance.unsubscribeUrl} />,
  );
  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: JACK.email,
    subject: "you've heard the ping",
    html,
    emailType: "onboarding_day_4_has_notification",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { onboarding_email_log_id: params.onboardingEmailLogId },
    customArgs: { onboarding_email_log_id: params.onboardingEmailLogId },
  });
}

// ─── Campaign senders (PR 3 — Marketing/lifecycle, OPS Dispatch) ──────────
//
// These four senders feed the campaign-template registry. Each accepts an
// optional `campaignId` so the dispatcher/worker can attribute opens,
// clicks, bounces back to the originating campaign via SendGrid customArgs
// and email_log.campaign_id.

export async function sendProductUpdate(params: {
  email: string;
  firstName?: string | null;
  headline?: string;
  eyebrow?: string;
  intro: string;
  items: Array<{ title: string; body: string }>;
  closing?: string;
  ctaLabel?: string;
  ctaUrl: string;
  campaignId?: string | null;
  userId?: string | null;
  subject?: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "product_update",
  });
  const html = await render(
    <ProductUpdate
      firstName={params.firstName ?? null}
      headline={params.headline}
      eyebrow={params.eyebrow}
      intro={params.intro}
      items={params.items}
      closing={params.closing}
      ctaLabel={params.ctaLabel}
      ctaUrl={params.ctaUrl}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: params.subject ?? params.headline ?? "What shipped this week.",
    html,
    emailType: "product_update",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { itemCount: params.items.length },
    campaignId: params.campaignId ?? null,
    userId: params.userId ?? undefined,
  });
}

export async function sendFeatureAnnouncement(params: {
  email: string;
  firstName?: string | null;
  featureName: string;
  headline: string;
  whatItDoes: string;
  whyItMatters: string;
  howToFindIt?: string;
  ctaUrl: string;
  ctaLabel?: string;
  campaignId?: string | null;
  userId?: string | null;
  subject?: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "feature_announcement",
  });
  const html = await render(
    <FeatureAnnouncement
      firstName={params.firstName ?? null}
      featureName={params.featureName}
      headline={params.headline}
      whatItDoes={params.whatItDoes}
      whyItMatters={params.whyItMatters}
      howToFindIt={params.howToFindIt}
      ctaUrl={params.ctaUrl}
      ctaLabel={params.ctaLabel}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: params.subject ?? params.headline,
    html,
    emailType: "feature_announcement",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { featureName: params.featureName },
    campaignId: params.campaignId ?? null,
    userId: params.userId ?? undefined,
  });
}

export async function sendReengagement(params: {
  email: string;
  firstName?: string | null;
  headline?: string;
  eyebrow?: string;
  daysSinceActive?: number;
  opener?: string;
  body?: string;
  closing?: string;
  ctaLabel?: string;
  ctaUrl: string;
  campaignId?: string | null;
  userId?: string | null;
  subject?: string;
}): Promise<GatedSendResult> {
  const compliance = buildComplianceHeaders({
    email: params.email,
    kind: "reengagement",
  });
  const html = await render(
    <Reengagement
      firstName={params.firstName ?? null}
      headline={params.headline}
      eyebrow={params.eyebrow}
      daysSinceActive={params.daysSinceActive}
      opener={params.opener}
      body={params.body}
      closing={params.closing}
      ctaLabel={params.ctaLabel}
      ctaUrl={params.ctaUrl}
      unsubscribeUrl={compliance.unsubscribeUrl}
      list={compliance.list}
    />,
  );

  return gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject:
      params.subject ?? params.headline ?? "Still running things from texts and Post-its?",
    html,
    emailType: "reengagement",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { daysSinceActive: params.daysSinceActive ?? null },
    campaignId: params.campaignId ?? null,
    userId: params.userId ?? undefined,
  });
}

// ─── Back-compat shims ─────────────────────────────────────────────────────
//
// `sendTransactionalEmail` and `sendEmail` exist so callers that build their
// own React element + render manually (notably `pmf-send.ts`) keep working
// until they migrate to a typed `sendXxx` template. Both default to the
// DISPATCH bucket and fall back to `SENDGRID_FROM_EMAIL` when DNS is not yet
// aligned for the bucket addresses. gatedSend auto-injects compliance
// headers in this path (the caller's pre-rendered HTML may not include the
// matching footer link, but the SMTP header still satisfies RFC-8058).

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  from?: string;
}): Promise<void> {
  await gatedSend({
    to: params.to,
    from: {
      email: params.from ?? DISPATCH.email,
      name: params.fromName ?? DISPATCH.name,
    },
    subject: params.subject,
    html: params.html,
    emailType: "transactional_generic",
    list: "global",
  });
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  from?: string;
  replyTo?: string;
}): Promise<void> {
  await gatedSend({
    to: params.to,
    from: {
      email: params.from ?? DISPATCH.email,
      name: params.fromName ?? DISPATCH.name,
    },
    replyTo: params.replyTo,
    subject: params.subject,
    html: params.html,
    text: params.text,
    emailType: "generic",
    list: "global",
  });
}
