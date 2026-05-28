import * as React from "react";
import { render as renderEmail } from "@react-email/render";

import * as PasswordResetMod from "./react/templates/PasswordReset";
import * as EmailVerificationMod from "./react/templates/EmailVerification";
import * as EmailChangeConfirmationMod from "./react/templates/EmailChangeConfirmation";
import * as TeamInviteMod from "./react/templates/TeamInvite";
import * as RoleNeededMod from "./react/templates/RoleNeeded";
import * as TrialExpiryWarningMod from "./react/templates/TrialExpiryWarning";
import * as TrialExpiryDiscountMod from "./react/templates/TrialExpiryDiscount";
import * as TrialExpiryReengagementMod from "./react/templates/TrialExpiryReengagement";
import * as BetaAccessRequestMod from "./react/templates/BetaAccessRequest";
import * as BetaAccessDecisionMod from "./react/templates/BetaAccessDecision";
import * as AdsBriefingMod from "./react/templates/AdsBriefing";
import * as PortalEstimateReadyMod from "./react/templates/PortalEstimateReady";
import * as PortalInvoiceReadyMod from "./react/templates/PortalInvoiceReady";
import * as PortalMagicLinkMod from "./react/templates/PortalMagicLink";
import * as PortalQuestionsReminderMod from "./react/templates/PortalQuestionsReminder";
import * as BlogNewsletterMod from "./react/templates/BlogNewsletter";
import * as FieldNotesNewsletterMod from "./react/templates/FieldNotesNewsletter";
import * as Day0WelcomeMod from "./react/templates/onboarding/Day0Welcome";
import * as Day1NoProjectMod from "./react/templates/onboarding/Day1NoProject";
import * as Day1HasProjectMod from "./react/templates/onboarding/Day1HasProject";
import * as Day3InboxMod from "./react/templates/onboarding/Day3Inbox";
import * as Day4NoNotificationMod from "./react/templates/onboarding/Day4NoNotification";
import * as Day4HasNotificationMod from "./react/templates/onboarding/Day4HasNotification";
import * as Day8EstimatesMod from "./react/templates/onboarding/Day8Estimates";
import * as Day14QuietMod from "./react/templates/onboarding/Day14Quiet";
import * as Day14ActiveMod from "./react/templates/onboarding/Day14Active";
import * as LostYouMod from "./react/templates/onboarding/LostYou";

export interface TemplateRegistryEntry {
  templateId: string;
  displayName: string;
  defaultSubject: string;
  Component: React.ComponentType<any>;
  previewProps: any;
  sourcePath: string;
}

export const TEMPLATE_REGISTRY: TemplateRegistryEntry[] = [
  {
    templateId: "password_reset",
    displayName: "Password Reset",
    defaultSubject: "Reset your OPS password",
    Component: PasswordResetMod.PasswordReset,
    previewProps: PasswordResetMod.previewProps,
    sourcePath: "src/lib/email/react/templates/PasswordReset.tsx",
  },
  {
    templateId: "email_verification",
    displayName: "Email Verification",
    defaultSubject: "Verify your OPS email",
    Component: EmailVerificationMod.EmailVerification,
    previewProps: EmailVerificationMod.previewProps,
    sourcePath: "src/lib/email/react/templates/EmailVerification.tsx",
  },
  {
    templateId: "email_change_confirmation",
    displayName: "Email Change Confirmation",
    defaultSubject: "Confirm your OPS email change",
    Component: EmailChangeConfirmationMod.EmailChangeConfirmation,
    previewProps: EmailChangeConfirmationMod.previewProps,
    sourcePath: "src/lib/email/react/templates/EmailChangeConfirmation.tsx",
  },
  {
    templateId: "team_invite",
    displayName: "Team Invite",
    defaultSubject: "You've been invited to OPS",
    Component: TeamInviteMod.TeamInvite,
    previewProps: TeamInviteMod.previewProps,
    sourcePath: "src/lib/email/react/templates/TeamInvite.tsx",
  },
  {
    templateId: "role_needed",
    displayName: "Role Needed",
    defaultSubject: "Action required: assign a role on OPS",
    Component: RoleNeededMod.RoleNeeded,
    previewProps: RoleNeededMod.previewProps,
    sourcePath: "src/lib/email/react/templates/RoleNeeded.tsx",
  },
  {
    templateId: "trial_expiry_warning",
    displayName: "Trial Expiry — Warning",
    defaultSubject: "Your OPS trial ends soon",
    Component: TrialExpiryWarningMod.TrialExpiryWarning,
    previewProps: TrialExpiryWarningMod.previewProps,
    sourcePath: "src/lib/email/react/templates/TrialExpiryWarning.tsx",
  },
  {
    templateId: "trial_expiry_discount",
    displayName: "Trial Expiry — Discount",
    defaultSubject: "One last offer before your trial ends",
    Component: TrialExpiryDiscountMod.TrialExpiryDiscount,
    previewProps: TrialExpiryDiscountMod.previewProps,
    sourcePath: "src/lib/email/react/templates/TrialExpiryDiscount.tsx",
  },
  {
    templateId: "trial_expiry_reengagement",
    displayName: "Trial Expiry — Reengagement",
    defaultSubject: "Your OPS workspace is still here",
    Component: TrialExpiryReengagementMod.TrialExpiryReengagement,
    previewProps: TrialExpiryReengagementMod.previewProps,
    sourcePath: "src/lib/email/react/templates/TrialExpiryReengagement.tsx",
  },
  {
    templateId: "beta_access_request",
    displayName: "Beta Access — Request",
    defaultSubject: "We received your OPS beta request",
    Component: BetaAccessRequestMod.BetaAccessRequest,
    previewProps: BetaAccessRequestMod.previewProps,
    sourcePath: "src/lib/email/react/templates/BetaAccessRequest.tsx",
  },
  {
    templateId: "beta_access_decision",
    displayName: "Beta Access — Decision",
    defaultSubject: "Your OPS beta status",
    Component: BetaAccessDecisionMod.BetaAccessDecision,
    previewProps: BetaAccessDecisionMod.previewProps,
    sourcePath: "src/lib/email/react/templates/BetaAccessDecision.tsx",
  },
  {
    templateId: "ads_briefing",
    displayName: "Ads Briefing",
    defaultSubject: "OPS ads briefing",
    Component: AdsBriefingMod.AdsBriefing,
    previewProps: AdsBriefingMod.previewProps,
    sourcePath: "src/lib/email/react/templates/AdsBriefing.tsx",
  },
  {
    templateId: "portal_estimate_ready",
    displayName: "Portal — Estimate Ready",
    defaultSubject: "Your estimate is ready",
    Component: PortalEstimateReadyMod.PortalEstimateReady,
    previewProps: PortalEstimateReadyMod.previewProps,
    sourcePath: "src/lib/email/react/templates/PortalEstimateReady.tsx",
  },
  {
    templateId: "portal_invoice_ready",
    displayName: "Portal — Invoice Ready",
    defaultSubject: "Your invoice is ready",
    Component: PortalInvoiceReadyMod.PortalInvoiceReady,
    previewProps: PortalInvoiceReadyMod.previewProps,
    sourcePath: "src/lib/email/react/templates/PortalInvoiceReady.tsx",
  },
  {
    templateId: "portal_magic_link",
    displayName: "Portal — Magic Link",
    defaultSubject: "Sign in to your OPS portal",
    Component: PortalMagicLinkMod.PortalMagicLink,
    previewProps: PortalMagicLinkMod.previewProps,
    sourcePath: "src/lib/email/react/templates/PortalMagicLink.tsx",
  },
  {
    templateId: "portal_questions_reminder",
    displayName: "Portal — Questions Reminder",
    defaultSubject: "Quick questions on your OPS project",
    Component: PortalQuestionsReminderMod.PortalQuestionsReminder,
    previewProps: PortalQuestionsReminderMod.previewProps,
    sourcePath: "src/lib/email/react/templates/PortalQuestionsReminder.tsx",
  },
  {
    templateId: "blog_newsletter",
    displayName: "Blog Newsletter",
    defaultSubject: "From the OPS blog",
    Component: BlogNewsletterMod.BlogNewsletter,
    previewProps: BlogNewsletterMod.previewProps,
    sourcePath: "src/lib/email/react/templates/BlogNewsletter.tsx",
  },
  {
    templateId: "field_notes_newsletter",
    displayName: "Field Notes Newsletter",
    defaultSubject: "OPS field notes",
    Component: FieldNotesNewsletterMod.FieldNotesNewsletter,
    previewProps: FieldNotesNewsletterMod.previewProps,
    sourcePath: "src/lib/email/react/templates/FieldNotesNewsletter.tsx",
  },
  {
    templateId: "onboarding_day_0_welcome",
    displayName: "Onboarding — Day 0 Founder Welcome",
    defaultSubject: "quick question",
    Component: Day0WelcomeMod.Day0Welcome,
    previewProps: Day0WelcomeMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day0Welcome.tsx",
  },
  {
    templateId: "onboarding_day_1_no_project",
    displayName: "Onboarding — Day 1A No Project",
    defaultSubject: "the move that gets OPS working",
    Component: Day1NoProjectMod.Day1NoProject,
    previewProps: Day1NoProjectMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day1NoProject.tsx",
  },
  {
    templateId: "onboarding_day_1_has_project",
    displayName: "Onboarding — Day 1B Has Project",
    defaultSubject: "you're moving",
    Component: Day1HasProjectMod.Day1HasProject,
    previewProps: Day1HasProjectMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day1HasProject.tsx",
  },
  {
    templateId: "onboarding_day_3_inbox",
    displayName: "Onboarding — Day 3 Inbox (Jack)",
    defaultSubject: "the part of OPS I'm most proud of",
    Component: Day3InboxMod.Day3Inbox,
    previewProps: Day3InboxMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day3Inbox.tsx",
  },
  {
    templateId: "onboarding_day_4_no_notification",
    displayName: "Onboarding — Day 4A No Notification",
    defaultSubject: "the notification you're working toward",
    Component: Day4NoNotificationMod.Day4NoNotification,
    previewProps: Day4NoNotificationMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day4NoNotification.tsx",
  },
  {
    templateId: "onboarding_day_4_has_notification",
    displayName: "Onboarding — Day 4B Has Notification",
    defaultSubject: "you've heard the ping",
    Component: Day4HasNotificationMod.Day4HasNotification,
    previewProps: Day4HasNotificationMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day4HasNotification.tsx",
  },
  {
    templateId: "onboarding_day_8_estimates",
    displayName: "Onboarding — Day 8 Estimates (Jack)",
    defaultSubject: "how your customers see your estimates",
    Component: Day8EstimatesMod.Day8Estimates,
    previewProps: Day8EstimatesMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day8Estimates.tsx",
  },
  {
    templateId: "onboarding_day_14_quiet",
    displayName: "Onboarding — Day 14 Quiet (Jack)",
    defaultSubject: "is OPS slotting in or in the way?",
    Component: Day14QuietMod.Day14Quiet,
    previewProps: Day14QuietMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day14Quiet.tsx",
  },
  {
    templateId: "onboarding_day_14_active",
    displayName: "Onboarding — Day 14 Active (Jack)",
    defaultSubject: "you're 14 days in",
    Component: Day14ActiveMod.Day14Active,
    previewProps: Day14ActiveMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/Day14Active.tsx",
  },
  {
    templateId: "onboarding_lost_you",
    displayName: "Onboarding — Lost You (re-engagement)",
    defaultSubject: "lost you?",
    Component: LostYouMod.LostYou,
    previewProps: LostYouMod.previewProps,
    sourcePath: "src/lib/email/react/templates/onboarding/LostYou.tsx",
  },
];

export function getTemplateEntry(templateId: string): TemplateRegistryEntry | null {
  return TEMPLATE_REGISTRY.find((t) => t.templateId === templateId) ?? null;
}

export async function renderTemplate(
  templateId: string,
  props: any
): Promise<{ html: string; text: string } | null> {
  const entry = getTemplateEntry(templateId);
  if (!entry) return null;
  const Component = entry.Component;
  const html = await renderEmail(React.createElement(Component, props), { pretty: false });
  // Disable html-to-text wordwrap (default 80 cols) so load-bearing phrases
  // like "I read every reply" or "it's my personal inbox" don't get split
  // across a hard newline mid-phrase. Email clients handle their own visual
  // wrapping; we should ship one line per paragraph and let them lay it out.
  const text = await renderEmail(React.createElement(Component, props), {
    plainText: true,
    htmlToTextOptions: { wordwrap: false },
  });
  return { html, text };
}
