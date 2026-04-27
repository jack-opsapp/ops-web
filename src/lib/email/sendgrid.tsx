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

import { DISPATCH, GATE, FIELD_NOTES, portalSender, type Sender } from "./senders";
import type { AdBriefing } from "@/lib/admin/briefing-types";
import { isSuppressed, filterSuppressed } from "./suppressions";
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
}): Promise<{ status: "sent" | "suppression_skipped"; reason?: string }> {
  ensureInitialized();
  const lower = params.to.trim().toLowerCase();
  if (!lower) throw new Error("gatedSend: empty `to` address");

  const list =
    params.list ?? (KIND_TO_LIST[params.emailType] ?? "global");

  if (await isSuppressed(lower, list)) {
    await logEmail({
      emailType: params.emailType,
      recipient: lower,
      subject: params.subject,
      status: "suppression_skipped",
      metadata: { ...(params.metadata ?? {}), list },
      userId: params.userId,
    });
    return { status: "suppression_skipped", reason: "suppressed" };
  }

  const headers =
    params.headers ?? buildComplianceHeaders({ email: lower, kind: params.emailType }).headers;

  await sgMail.send({
    to: params.to,
    from: params.from,
    replyTo: params.replyTo,
    subject: params.subject,
    html: params.html,
    text: params.text,
    headers,
  });

  await logEmail({
    emailType: params.emailType,
    recipient: lower,
    subject: params.subject,
    status: "sent",
    metadata: { ...(params.metadata ?? {}), list, from: params.from.email },
    userId: params.userId,
  });

  return { status: "sent" };
}

/**
 * Append a row to email_log. Never throws — logging failures are emitted
 * to console.error and swallowed so they don't break the send.
 */
async function logEmail(params: {
  emailType: string;
  recipient: string;
  subject: string;
  status: "sent" | "failed" | "suppression_skipped";
  metadata?: Record<string, unknown>;
  userId?: string;
  errorMessage?: string;
}): Promise<void> {
  try {
    const db = getServiceRoleClient();
    const { error } = await db.from("email_log").insert({
      email_type: params.emailType,
      recipient_email: params.recipient,
      subject: params.subject,
      status: params.status,
      error_message: params.errorMessage ?? null,
      metadata: params.metadata ?? {},
      user_id: params.userId ?? null,
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
  /** @deprecated retained for backward compat; no longer used */
  accentColor?: string;
  /** @deprecated retained for backward compat; no longer used */
  logoUrl?: string | null;
}): Promise<void> {
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

  await gatedSend({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject,
    html,
    emailType: "trial_expiry_warning",
    list: compliance.list,
    headers: compliance.headers,
    metadata: { companyName: params.companyName, daysRemaining: params.daysRemaining },
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
