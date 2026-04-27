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

import { DISPATCH, GATE, FIELD_NOTES, portalSender } from "./senders";
import type { AdBriefing } from "@/lib/admin/briefing-types";

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

function buildUnsubscribeUrl(email: string, list: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}&list=${encodeURIComponent(list)}`;
}

// ─── Portal whitelabel ─────────────────────────────────────────────────────

export async function sendMagicLink(params: {
  email: string;
  token: string;
  companyName: string;
  accentColor: string;
  logoUrl?: string | null;
}): Promise<void> {
  ensureInitialized();

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${params.token}`;
  const html = await render(
    <PortalMagicLink
      companyName={params.companyName}
      portalUrl={portalUrl}
      accentColor={params.accentColor}
      logoUrl={params.logoUrl ?? null}
    />,
  );

  await sgMail.send({
    to: params.email,
    from: portalSender(params.companyName),
    replyTo: getPortalFromEmail(),
    subject: `Access your ${params.companyName} portal`,
    html,
  });
}

export async function sendEstimateReady(params: {
  email: string;
  estimateNumber: string;
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl?: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = await render(
    <PortalEstimateReady
      companyName={params.companyName}
      estimateNumber={params.estimateNumber}
      portalUrl={params.portalUrl}
      accentColor={params.accentColor}
      logoUrl={params.logoUrl ?? null}
    />,
  );

  await sgMail.send({
    to: params.email,
    from: portalSender(params.companyName),
    replyTo: getPortalFromEmail(),
    subject: `Estimate #${params.estimateNumber} from ${params.companyName}`,
    html,
  });
}

export async function sendQuestionsReminder(params: {
  email: string;
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl?: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = await render(
    <PortalQuestionsReminder
      companyName={params.companyName}
      portalUrl={params.portalUrl}
      accentColor={params.accentColor}
      logoUrl={params.logoUrl ?? null}
    />,
  );

  await sgMail.send({
    to: params.email,
    from: portalSender(params.companyName),
    replyTo: getPortalFromEmail(),
    subject: `${params.companyName} needs a few answers from you`,
    html,
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
}): Promise<void> {
  ensureInitialized();

  const html = await render(
    <PortalInvoiceReady
      companyName={params.companyName}
      invoiceNumber={params.invoiceNumber}
      amount={params.amount}
      portalUrl={params.portalUrl}
      accentColor={params.accentColor}
      logoUrl={params.logoUrl ?? null}
    />,
  );

  await sgMail.send({
    to: params.email,
    from: portalSender(params.companyName),
    replyTo: getPortalFromEmail(),
    subject: `Invoice #${params.invoiceNumber} from ${params.companyName} — ${params.amount}`,
    html,
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
  ensureInitialized();

  const html = await render(
    <TeamInvite
      companyName={params.companyName}
      joinUrl={params.joinUrl}
      inviterName={params.inviterName}
      inviterEmail={params.inviterEmail}
      companyCode={params.companyCode}
      roleName={params.roleName}
    />,
  );

  await sgMail.send({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `${params.inviterName} invited you to join ${params.companyName} on OPS`,
    html,
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
  ensureInitialized();

  const html = await render(
    <RoleNeeded
      userName={params.userName}
      companyName={params.companyName}
      assignUrl={params.assignUrl}
    />,
  );

  await sgMail.send({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `${params.userName} joined ${params.companyName} and needs a role`,
    html,
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
  ensureInitialized();

  const html = await render(<BetaAccessRequest {...params} />);

  await sgMail.send({
    to: "jack@opsapp.co",
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `Beta Access Request — ${params.featureTitle} — ${params.companyName}`,
    html,
  });
}

export async function sendBetaAccessDecision(params: {
  userEmail: string;
  userName: string;
  featureTitle: string;
  approved: boolean;
  adminNotes: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = await render(
    <BetaAccessDecision
      userName={params.userName}
      featureTitle={params.featureTitle}
      approved={params.approved}
      adminNotes={params.adminNotes}
    />,
  );

  await sgMail.send({
    to: params.userEmail,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: params.approved
      ? `Your OPS Beta Access — Approved`
      : `Your OPS Beta Access Request — ${params.featureTitle}`,
    html,
  });
}

export async function sendAdsBriefing(params: {
  recipientEmails: string[];
  briefing: AdBriefing;
}): Promise<void> {
  ensureInitialized();
  const html = await render(<AdsBriefing briefing={params.briefing} />);
  const subject = `[OPS Intel] Google Ads Weekly — ${params.briefing.period_start} to ${params.briefing.period_end}`;

  await Promise.all(
    params.recipientEmails.map((email) =>
      sgMail.send({
        to: email,
        from: DISPATCH,
        replyTo: DISPATCH.email,
        subject,
        html,
      }),
    ),
  );
}

// ─── OPS Gate ──────────────────────────────────────────────────────────────

export async function sendPasswordReset(params: {
  email: string;
  resetLink: string;
}): Promise<void> {
  ensureInitialized();

  const html = await render(<PasswordReset resetLink={params.resetLink} />);

  await sgMail.send({
    to: params.email,
    from: GATE,
    replyTo: GATE.email,
    subject: "Reset your OPS password",
    html,
  });
}

export async function sendEmailVerification(params: {
  email: string;
  verifyLink: string;
}): Promise<void> {
  ensureInitialized();

  const html = await render(<EmailVerification verifyLink={params.verifyLink} />);

  await sgMail.send({
    to: params.email,
    from: GATE,
    replyTo: GATE.email,
    subject: "Verify your OPS email",
    html,
  });
}

export async function sendEmailChangeConfirmation(params: {
  toEmail: string;
  newEmail: string;
  oldEmail: string;
  recoveryLink: string;
}): Promise<void> {
  ensureInitialized();

  const html = await render(
    <EmailChangeConfirmation
      newEmail={params.newEmail}
      oldEmail={params.oldEmail}
      recoveryLink={params.recoveryLink}
    />,
  );

  await sgMail.send({
    to: params.toEmail,
    from: GATE,
    replyTo: GATE.email,
    subject: "Your OPS sign-in email changed",
    html,
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
  errors: string[];
  results: Array<{ email: string; status: "sent" | "failed"; error?: string }>;
}

const BLOG_NEWSLETTER_BATCH_SIZE = 100;

export async function sendBlogNewsletter(params: {
  post: BlogNewsletterPost;
  recipients: BlogNewsletterRecipient[];
}): Promise<BlogNewsletterResult> {
  ensureInitialized();

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
    errors: [],
    results: [],
  };

  for (let i = 0; i < unique.length; i += BLOG_NEWSLETTER_BATCH_SIZE) {
    const batch = unique.slice(i, i + BLOG_NEWSLETTER_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const unsubscribeUrl = buildUnsubscribeUrl(r.email, "field-notes");
        const html = await render(
          <BlogNewsletter
            firstName={r.first_name}
            title={params.post.title}
            teaser={params.post.teaser}
            thumbnailUrl={params.post.thumbnail_url}
            emailContent={bodyContent}
            postUrl={postUrl}
            unsubscribeUrl={unsubscribeUrl}
          />,
        );
        await sgMail.send({
          to: r.email,
          from: FIELD_NOTES,
          replyTo: FIELD_NOTES.email,
          subject,
          html,
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
  ensureInitialized();

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
    errors: [],
    results: [],
  };

  for (let i = 0; i < unique.length; i += BLOG_NEWSLETTER_BATCH_SIZE) {
    const batch = unique.slice(i, i + BLOG_NEWSLETTER_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const unsubscribeUrl = buildUnsubscribeUrl(r.email, "field-notes");
        const html = await render(
          <FieldNotesNewsletter
            firstName={r.first_name}
            issueNumber={params.issue.issueNumber}
            issueDate={params.issue.issueDate}
            intro={params.issue.intro}
            companyNews={params.issue.companyNews}
            industryInsights={params.issue.industryInsights}
            fullIssueUrl={params.issue.fullIssueUrl}
            unsubscribeUrl={unsubscribeUrl}
          />,
        );
        await sgMail.send({
          to: r.email,
          from: FIELD_NOTES,
          replyTo: FIELD_NOTES.email,
          subject,
          html,
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
  ensureInitialized();

  const unsubscribeUrl = buildUnsubscribeUrl(params.email, "trial");
  const html = await render(
    <TrialExpiryWarning
      companyName={params.companyName}
      daysRemaining={params.daysRemaining}
      trialEndDisplay={params.trialEndDisplay}
      subscribeUrl={params.subscribeUrl}
      unsubscribeUrl={unsubscribeUrl}
    />,
  );

  const subject =
    params.daysRemaining === 1
      ? "Tomorrow — your OPS trial ends"
      : `${params.daysRemaining} days left on your OPS trial`;

  await sgMail.send({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject,
    html,
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
  ensureInitialized();

  const unsubscribeUrl = buildUnsubscribeUrl(params.email, "trial");
  const html = await render(
    <TrialExpiryDiscount
      companyName={params.companyName}
      daysRemaining={params.daysRemaining}
      trialEndDisplay={params.trialEndDisplay}
      promoCode50={params.promoCode50}
      promoCode30={params.promoCode30}
      subscribeUrl={params.subscribeUrl}
      unsubscribeUrl={unsubscribeUrl}
    />,
  );

  await sgMail.send({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject: `${params.daysRemaining} days left — 50% off or 30% off, your call`,
    html,
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
  ensureInitialized();

  const unsubscribeUrl = buildUnsubscribeUrl(params.email, "trial");
  const html = await render(
    <TrialExpiryReengagement
      companyName={params.companyName}
      daysSinceExpiry={params.daysSinceExpiry}
      promoCode50={params.promoCode50}
      promoCode30={params.promoCode30}
      subscribeUrl={params.subscribeUrl}
      unsubscribeUrl={unsubscribeUrl}
    />,
  );

  const subject =
    params.daysSinceExpiry >= 30
      ? "Last check-in before we stop"
      : "Still thinking about it?";

  await sgMail.send({
    to: params.email,
    from: DISPATCH,
    replyTo: DISPATCH.email,
    subject,
    html,
  });
}

// ─── Back-compat shims ─────────────────────────────────────────────────────
//
// `sendTransactionalEmail` and `sendEmail` exist so callers that build their
// own React element + render manually (notably `pmf-send.ts`) keep working
// until they migrate to a typed `sendXxx` template. Both default to the
// DISPATCH bucket and fall back to `SENDGRID_FROM_EMAIL` when DNS is not yet
// aligned for the bucket addresses.

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  from?: string;
}): Promise<void> {
  ensureInitialized();
  await sgMail.send({
    to: params.to,
    from: {
      email: params.from ?? DISPATCH.email,
      name: params.fromName ?? DISPATCH.name,
    },
    subject: params.subject,
    html: params.html,
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
  ensureInitialized();
  await sgMail.send({
    to: params.to,
    from: {
      email: params.from ?? DISPATCH.email,
      name: params.fromName ?? DISPATCH.name,
    },
    replyTo: params.replyTo,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
}
