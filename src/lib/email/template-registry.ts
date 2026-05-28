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
import * as SpecOwnerApprovalRequiredMod from "./react/templates/SpecOwnerApprovalRequired";
import * as SpecOwnerApprovalGrantedMod from "./react/templates/SpecOwnerApprovalGranted";
import * as SpecOwnerApprovalDeclinedMod from "./react/templates/SpecOwnerApprovalDeclined";
import * as SpecDepositConfirmedMod from "./react/templates/SpecDepositConfirmed";
import * as SpecQuebecRejectedPostStripeMod from "./react/templates/SpecQuebecRejectedPostStripe";
import * as SpecIntakeReminder1Mod from "./react/templates/SpecIntakeReminder1";
import * as SpecIntakeReminder2Mod from "./react/templates/SpecIntakeReminder2";
import * as SpecIntakeReminder3Mod from "./react/templates/SpecIntakeReminder3";
import * as SpecIntakeCompletedCustomerMod from "./react/templates/SpecIntakeCompletedCustomer";
import * as SpecIntakeCompletedNoDiscovery1Mod from "./react/templates/SpecIntakeCompletedNoDiscovery1";
import * as SpecIntakeCompletedNoDiscovery2Mod from "./react/templates/SpecIntakeCompletedNoDiscovery2";
import * as SpecIntakeCompletedNoDiscovery3Mod from "./react/templates/SpecIntakeCompletedNoDiscovery3";
import * as SpecScopeDocReadyMod from "./react/templates/SpecScopeDocReady";
import * as SpecScopeDocSignedCustomerMod from "./react/templates/SpecScopeDocSignedCustomer";
import * as SpecP2InvoiceMod from "./react/templates/SpecP2Invoice";
import * as SpecP3InvoiceMod from "./react/templates/SpecP3Invoice";
import * as SpecP4InvoiceMod from "./react/templates/SpecP4Invoice";
import * as SpecSupportWindowOpenMod from "./react/templates/SpecSupportWindowOpen";
import * as SpecRefundProcessedMod from "./react/templates/SpecRefundProcessed";
import * as SpecRefundDeniedMod from "./react/templates/SpecRefundDenied";
import * as SpecEntitlementDisabledMod from "./react/templates/SpecEntitlementDisabled";
import * as SpecEntitlementEnabledMod from "./react/templates/SpecEntitlementEnabled";
import * as SpecOwnerApprovalExpiredBuyerMod from "./react/templates/SpecOwnerApprovalExpiredBuyer";
import * as SpecOwnerApprovalExpiredOwnerMod from "./react/templates/SpecOwnerApprovalExpiredOwner";
import * as SpecHoldExpiredCustomerRequestedMod from "./react/templates/SpecHoldExpiredCustomerRequested";

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
  // ─── SPEC engagement templates (Phase 1) ───────────────────────────────────
  {
    templateId: "spec.owner_approval_required",
    displayName: "SPEC — Owner Approval Required",
    defaultSubject: "SPEC APPROVAL REQUESTED",
    Component: SpecOwnerApprovalRequiredMod.SpecOwnerApprovalRequired,
    previewProps: SpecOwnerApprovalRequiredMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecOwnerApprovalRequired.tsx",
  },
  {
    templateId: "spec.owner_approval_granted",
    displayName: "SPEC — Owner Approval Granted",
    defaultSubject: "SPEC APPROVED — COMPLETE PAYMENT",
    Component: SpecOwnerApprovalGrantedMod.SpecOwnerApprovalGranted,
    previewProps: SpecOwnerApprovalGrantedMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecOwnerApprovalGranted.tsx",
  },
  {
    templateId: "spec.owner_approval_declined",
    displayName: "SPEC — Owner Approval Declined",
    defaultSubject: "SPEC PURCHASE DECLINED",
    Component: SpecOwnerApprovalDeclinedMod.SpecOwnerApprovalDeclined,
    previewProps: SpecOwnerApprovalDeclinedMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecOwnerApprovalDeclined.tsx",
  },
  {
    templateId: "spec.deposit_confirmed",
    displayName: "SPEC — Deposit Confirmed",
    defaultSubject: "SPEC DEPOSIT RECEIVED",
    Component: SpecDepositConfirmedMod.SpecDepositConfirmed,
    previewProps: SpecDepositConfirmedMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecDepositConfirmed.tsx",
  },
  {
    templateId: "spec.quebec_rejected_post_stripe",
    displayName: "SPEC — Quebec Rejected (Post-Stripe)",
    defaultSubject: "SPEC PURCHASE CANCELLED — FULL REFUND ISSUED",
    Component: SpecQuebecRejectedPostStripeMod.SpecQuebecRejectedPostStripe,
    previewProps: SpecQuebecRejectedPostStripeMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecQuebecRejectedPostStripe.tsx",
  },
  {
    templateId: "spec.intake_reminder_1",
    displayName: "SPEC — Intake Reminder 1 (D14)",
    defaultSubject: "SPEC INTAKE WAITING",
    Component: SpecIntakeReminder1Mod.SpecIntakeReminder1,
    previewProps: SpecIntakeReminder1Mod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecIntakeReminder1.tsx",
  },
  {
    templateId: "spec.intake_reminder_2",
    displayName: "SPEC — Intake Reminder 2 (D30)",
    defaultSubject: "SPEC PAUSED",
    Component: SpecIntakeReminder2Mod.SpecIntakeReminder2,
    previewProps: SpecIntakeReminder2Mod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecIntakeReminder2.tsx",
  },
  {
    templateId: "spec.intake_reminder_3",
    displayName: "SPEC — Intake Reminder 3 (D60 final)",
    defaultSubject: "SPEC — FINAL CHECK-IN",
    Component: SpecIntakeReminder3Mod.SpecIntakeReminder3,
    previewProps: SpecIntakeReminder3Mod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecIntakeReminder3.tsx",
  },
  {
    templateId: "spec.intake_completed_customer",
    displayName: "SPEC — Intake Completed (Customer)",
    defaultSubject: "INTAKE RECEIVED — BOOK DISCOVERY",
    Component: SpecIntakeCompletedCustomerMod.SpecIntakeCompletedCustomer,
    previewProps: SpecIntakeCompletedCustomerMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecIntakeCompletedCustomer.tsx",
  },
  {
    templateId: "spec.intake_completed_no_discovery_1",
    displayName: "SPEC — No Discovery 1 (D7)",
    defaultSubject: "BOOK YOUR DISCOVERY SESSION",
    Component: SpecIntakeCompletedNoDiscovery1Mod.SpecIntakeCompletedNoDiscovery1,
    previewProps: SpecIntakeCompletedNoDiscovery1Mod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecIntakeCompletedNoDiscovery1.tsx",
  },
  {
    templateId: "spec.intake_completed_no_discovery_2",
    displayName: "SPEC — No Discovery 2 (D21)",
    defaultSubject: "SPEC PAUSED",
    Component: SpecIntakeCompletedNoDiscovery2Mod.SpecIntakeCompletedNoDiscovery2,
    previewProps: SpecIntakeCompletedNoDiscovery2Mod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecIntakeCompletedNoDiscovery2.tsx",
  },
  {
    templateId: "spec.intake_completed_no_discovery_3",
    displayName: "SPEC — No Discovery 3 (D60 final)",
    defaultSubject: "SPEC — FINAL CHECK-IN",
    Component: SpecIntakeCompletedNoDiscovery3Mod.SpecIntakeCompletedNoDiscovery3,
    previewProps: SpecIntakeCompletedNoDiscovery3Mod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecIntakeCompletedNoDiscovery3.tsx",
  },
  {
    templateId: "spec.scope_doc_ready",
    displayName: "SPEC — Scope Doc Ready",
    defaultSubject: "SCOPE READY FOR SIGN-OFF",
    Component: SpecScopeDocReadyMod.SpecScopeDocReady,
    previewProps: SpecScopeDocReadyMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecScopeDocReady.tsx",
  },
  {
    templateId: "spec.scope_doc_signed_customer",
    displayName: "SPEC — Scope Signed (Customer)",
    defaultSubject: "SCOPE LOCKED — P2 INCOMING",
    Component: SpecScopeDocSignedCustomerMod.SpecScopeDocSignedCustomer,
    previewProps: SpecScopeDocSignedCustomerMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecScopeDocSignedCustomer.tsx",
  },
  {
    templateId: "spec.p2_invoice",
    displayName: "SPEC — P2 Invoice",
    defaultSubject: "P2 INVOICE",
    Component: SpecP2InvoiceMod.SpecP2Invoice,
    previewProps: SpecP2InvoiceMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecP2Invoice.tsx",
  },
  {
    templateId: "spec.p3_invoice",
    displayName: "SPEC — P3 Invoice",
    defaultSubject: "P3 INVOICE",
    Component: SpecP3InvoiceMod.SpecP3Invoice,
    previewProps: SpecP3InvoiceMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecP3Invoice.tsx",
  },
  {
    templateId: "spec.p4_invoice",
    displayName: "SPEC — P4 Invoice",
    defaultSubject: "P4 INVOICE",
    Component: SpecP4InvoiceMod.SpecP4Invoice,
    previewProps: SpecP4InvoiceMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecP4Invoice.tsx",
  },
  {
    templateId: "spec.support_window_open",
    displayName: "SPEC — Support Window Open",
    defaultSubject: "SUPPORT WINDOW OPEN",
    Component: SpecSupportWindowOpenMod.SpecSupportWindowOpen,
    previewProps: SpecSupportWindowOpenMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecSupportWindowOpen.tsx",
  },
  {
    templateId: "spec.refund_processed",
    displayName: "SPEC — Refund Processed",
    defaultSubject: "REFUND PROCESSED",
    Component: SpecRefundProcessedMod.SpecRefundProcessed,
    previewProps: SpecRefundProcessedMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecRefundProcessed.tsx",
  },
  {
    templateId: "spec.refund_denied",
    displayName: "SPEC — Refund Denied",
    defaultSubject: "REFUND REQUEST DENIED",
    Component: SpecRefundDeniedMod.SpecRefundDenied,
    previewProps: SpecRefundDeniedMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecRefundDenied.tsx",
  },
  {
    templateId: "spec.entitlement_disabled",
    displayName: "SPEC — Entitlement Disabled",
    defaultSubject: "SPEC ACCESS PAUSED",
    Component: SpecEntitlementDisabledMod.SpecEntitlementDisabled,
    previewProps: SpecEntitlementDisabledMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecEntitlementDisabled.tsx",
  },
  {
    templateId: "spec.entitlement_enabled",
    displayName: "SPEC — Entitlement Enabled",
    defaultSubject: "SPEC ACCESS RESTORED",
    Component: SpecEntitlementEnabledMod.SpecEntitlementEnabled,
    previewProps: SpecEntitlementEnabledMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecEntitlementEnabled.tsx",
  },
  {
    templateId: "spec.owner_approval_expired_buyer",
    displayName: "SPEC — Owner Approval Expired (Buyer)",
    defaultSubject: "SPEC REQUEST EXPIRED",
    Component: SpecOwnerApprovalExpiredBuyerMod.SpecOwnerApprovalExpiredBuyer,
    previewProps: SpecOwnerApprovalExpiredBuyerMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecOwnerApprovalExpiredBuyer.tsx",
  },
  {
    templateId: "spec.owner_approval_expired_owner",
    displayName: "SPEC — Owner Approval Expired (Owner)",
    defaultSubject: "SPEC REQUEST EXPIRED",
    Component: SpecOwnerApprovalExpiredOwnerMod.SpecOwnerApprovalExpiredOwner,
    previewProps: SpecOwnerApprovalExpiredOwnerMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecOwnerApprovalExpiredOwner.tsx",
  },
  {
    templateId: "spec.hold_expired_customer_requested",
    displayName: "SPEC — Hold Expired (Customer Requested)",
    defaultSubject: "SPEC ENGAGEMENT STALLED — 90-DAY PAUSE EXPIRED",
    Component: SpecHoldExpiredCustomerRequestedMod.SpecHoldExpiredCustomerRequested,
    previewProps: SpecHoldExpiredCustomerRequestedMod.previewProps,
    sourcePath: "src/lib/email/react/templates/SpecHoldExpiredCustomerRequested.tsx",
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
