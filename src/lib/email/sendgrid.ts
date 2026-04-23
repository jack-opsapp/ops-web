/**
 * OPS Web - SendGrid Email Service
 *
 * Sends branded portal emails: magic links, estimate notifications,
 * question reminders, and invoice notifications.
 *
 * Uses SENDGRID_API_KEY and SENDGRID_FROM_EMAIL environment variables.
 */

import sgMail from "@sendgrid/mail";

import { getAppUrl } from "@/lib/utils/app-url";
import { magicLinkTemplate } from "./templates/magic-link";
import { estimateReadyTemplate } from "./templates/estimate-ready";
import { questionsReminderTemplate } from "./templates/questions-reminder";
import { invoiceReadyTemplate } from "./templates/invoice-ready";
import { teamInviteTemplate } from "./templates/team-invite";
import { roleNeededTemplate } from "./templates/role-needed";
import { betaAccessRequestTemplate } from "./templates/beta-access-request";
import { betaAccessDecisionTemplate } from "./templates/beta-access-decision";
import { adsBriefingTemplate } from "./templates/ads-briefing";
import { passwordResetTemplate } from "./templates/password-reset";
import { blogNewsletterTemplate } from "./templates/blog-newsletter";
import { trialExpiryWarningTemplate } from "./templates/trial-expiry-warning";
import { trialExpiryDiscountTemplate } from "./templates/trial-expiry-discount";
import { trialExpiryReengagementTemplate } from "./templates/trial-expiry-reengagement";
import type { AdBriefing } from "@/lib/admin/briefing-types";

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("Missing SENDGRID_API_KEY");
  sgMail.setApiKey(apiKey);
  initialized = true;
}

function getFromEmail(): string {
  return process.env.SENDGRID_FROM_EMAIL ?? "noreply@opsapp.co";
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function sendMagicLink(params: {
  email: string;
  token: string;
  companyName: string;
  accentColor: string;
  logoUrl?: string | null;
}): Promise<void> {
  ensureInitialized();

  const portalUrl = `${getAppUrl()}/portal/${params.token}`;
  const html = magicLinkTemplate({
    companyName: params.companyName,
    portalUrl,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl ?? null,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: params.companyName },
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

  const html = estimateReadyTemplate({
    companyName: params.companyName,
    estimateNumber: params.estimateNumber,
    portalUrl: params.portalUrl,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl ?? null,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: params.companyName },
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

  const html = questionsReminderTemplate({
    companyName: params.companyName,
    portalUrl: params.portalUrl,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl ?? null,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: params.companyName },
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

  const html = invoiceReadyTemplate({
    companyName: params.companyName,
    invoiceNumber: params.invoiceNumber,
    amount: params.amount,
    portalUrl: params.portalUrl,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl ?? null,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: params.companyName },
    subject: `Invoice #${params.invoiceNumber} from ${params.companyName} — ${params.amount}`,
    html,
  });
}

export async function sendTeamInvite(params: {
  email: string;
  companyName: string;
  joinUrl: string;
  accentColor?: string;
  logoUrl?: string | null;
  inviterName: string;
  inviterEmail: string;
  companyCode: string;
  roleName: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = teamInviteTemplate({
    companyName: params.companyName,
    joinUrl: params.joinUrl,
    accentColor: params.accentColor ?? "#6F94B0",
    logoUrl: params.logoUrl ?? null,
    inviterName: params.inviterName,
    inviterEmail: params.inviterEmail,
    companyCode: params.companyCode,
    roleName: params.roleName,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: "OPS" },
    subject: `${params.inviterName} invited you to join ${params.companyName} on OPS`,
    html,
  });
}

export async function sendRoleNeeded(params: {
  email: string;
  userName: string;
  companyName: string;
  assignUrl: string;
  accentColor?: string;
  logoUrl?: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = roleNeededTemplate({
    userName: params.userName,
    companyName: params.companyName,
    assignUrl: params.assignUrl,
    accentColor: params.accentColor ?? "#6F94B0",
    logoUrl: params.logoUrl ?? null,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: "OPS" },
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

  const html = betaAccessRequestTemplate(params);

  await sgMail.send({
    to: "jack@opsapp.co",
    from: { email: getFromEmail(), name: "OPS" },
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

  const html = betaAccessDecisionTemplate({
    userName: params.userName,
    featureTitle: params.featureTitle,
    approved: params.approved,
    adminNotes: params.adminNotes,
  });

  await sgMail.send({
    to: params.userEmail,
    from: { email: getFromEmail(), name: "OPS" },
    subject: params.approved
      ? `Your OPS Beta Access — Approved!`
      : `Your OPS Beta Access Request — ${params.featureTitle}`,
    html,
  });
}

export async function sendAdsBriefing(params: {
  recipientEmails: string[];
  briefing: AdBriefing;
}): Promise<void> {
  ensureInitialized();
  const html = adsBriefingTemplate(params.briefing);
  const subject = `[OPS Intel] Google Ads Weekly — ${params.briefing.period_start} to ${params.briefing.period_end}`;

  await Promise.all(
    params.recipientEmails.map((email) =>
      sgMail.send({
        to: email,
        from: getFromEmail(),
        subject,
        html,
      })
    )
  );
}

export async function sendPasswordReset(params: {
  email: string;
  resetLink: string;
}): Promise<void> {
  ensureInitialized();

  const html = passwordResetTemplate({
    resetLink: params.resetLink,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: "OPS" },
    subject: "Reset your OPS password",
    html,
  });
}

// ─── Blog Newsletter (OPS Field Notes) ───────────────────────────────────────

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

const BLOG_NEWSLETTER_FROM = "info@opsapp.co";
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

  const appUrl = getAppUrl();
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
        const unsubscribeUrl = `${appUrl}/unsubscribe?email=${encodeURIComponent(r.email)}`;
        const html = blogNewsletterTemplate({
          firstName: r.first_name,
          title: params.post.title,
          teaser: params.post.teaser,
          thumbnailUrl: params.post.thumbnail_url,
          emailContent: bodyContent,
          postUrl,
          unsubscribeUrl,
        });
        await sgMail.send({
          to: r.email,
          from: { email: BLOG_NEWSLETTER_FROM, name: "OPS Field Notes" },
          subject,
          html,
        });
        return r.email;
      })
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

// ─── Trial Expiry Emails ────────────────────────────────────────────────────

export async function sendTrialExpiryWarning(params: {
  email: string;
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
  subscribeUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = trialExpiryWarningTemplate({
    companyName: params.companyName,
    daysRemaining: params.daysRemaining,
    trialEndDisplay: params.trialEndDisplay,
    subscribeUrl: params.subscribeUrl,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
  });

  const subject =
    params.daysRemaining === 1
      ? "Tomorrow — your OPS trial ends"
      : `${params.daysRemaining} days left on your OPS trial`;

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: "OPS" },
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
  accentColor: string;
  logoUrl: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = trialExpiryDiscountTemplate({
    companyName: params.companyName,
    daysRemaining: params.daysRemaining,
    trialEndDisplay: params.trialEndDisplay,
    promoCode50: params.promoCode50,
    promoCode30: params.promoCode30,
    subscribeUrl: params.subscribeUrl,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: "OPS" },
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
  accentColor: string;
  logoUrl: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = trialExpiryReengagementTemplate({
    companyName: params.companyName,
    daysSinceExpiry: params.daysSinceExpiry,
    promoCode50: params.promoCode50,
    promoCode30: params.promoCode30,
    subscribeUrl: params.subscribeUrl,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
  });

  const subject =
    params.daysSinceExpiry >= 30
      ? "Last check-in before we stop"
      : "Still thinking about it?";

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: "OPS" },
    subject,
    html,
  });
}
