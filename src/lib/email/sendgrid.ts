/**
 * OPS Web - SendGrid Email Service
 *
 * Sends branded portal emails: magic links, estimate notifications,
 * question reminders, and invoice notifications.
 *
 * Uses SENDGRID_API_KEY and SENDGRID_FROM_EMAIL environment variables.
 */

import sgMail from "@sendgrid/mail";

import { magicLinkTemplate } from "./templates/magic-link";
import { estimateReadyTemplate } from "./templates/estimate-ready";
import { questionsReminderTemplate } from "./templates/questions-reminder";
import { invoiceReadyTemplate } from "./templates/invoice-ready";
import { teamInviteTemplate } from "./templates/team-invite";
import { roleNeededTemplate } from "./templates/role-needed";
import { betaAccessRequestTemplate } from "./templates/beta-access-request";
import { betaAccessDecisionTemplate } from "./templates/beta-access-decision";

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

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${params.token}`;
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
}): Promise<void> {
  ensureInitialized();

  const html = teamInviteTemplate({
    companyName: params.companyName,
    joinUrl: params.joinUrl,
    accentColor: params.accentColor ?? "#417394",
    logoUrl: params.logoUrl ?? null,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: "OPS" },
    subject: `Join ${params.companyName} on OPS`,
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
    accentColor: params.accentColor ?? "#417394",
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
