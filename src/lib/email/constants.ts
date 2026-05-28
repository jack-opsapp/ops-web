// src/lib/email/constants.ts
/**
 * OPS legal identifiers used in compliance footers and CASL/CAN-SPAM disclosures.
 *
 * The physical address is required by CAN-SPAM (US, 15 USC 7704) and recommended
 * by CASL (Canada, S.C. 2010, c. 23). It must appear in every commercial email.
 */

export const OPS_LEGAL_NAME = "OPS LTD.";

export const OPS_PHYSICAL_ADDRESS = "1515 Douglas St, Victoria, BC V8W 2G4, Canada";

export const OPS_SUPPORT_EMAIL = "support@opsapp.co";

/**
 * Display names per List-Unsubscribe `list` value. Used in the footer
 * sentence: "You're receiving this because you subscribed to {DISPLAY_NAME}."
 */
export const LIST_DISPLAY_NAMES: Record<string, string> = {
  global: "OPS account notifications",
  field_notes: "Field Notes (newsletter)",
  product_updates: "OPS product updates",
  reengagement: "OPS reengagement campaigns",
  blog: "OPS blog",
  beta: "OPS beta program",
};

/**
 * Maps an email kind (the typed sendXxx call) to its List-Unsubscribe `list`
 * value. Transactional emails (auth, billing) use 'global' so unsubscribing
 * from one suppresses all email — the user is asking us to leave them alone.
 * Marketing emails use a per-list value so unsubscribing from one channel
 * doesn't kill transactional.
 */
export const KIND_TO_LIST: Record<string, string> = {
  password_reset: "global",
  email_verification: "global",
  email_change_confirmation: "global",
  team_invite: "global",
  role_needed: "global",
  trial_expiry_warning: "global",
  trial_expiry_discount: "global",
  trial_expiry_reengagement: "global",
  beta_access_request: "global",
  beta_access_decision: "global",
  ads_briefing: "global",
  portal_estimate_ready: "global",
  portal_invoice_ready: "global",
  portal_magic_link: "global",
  portal_questions_reminder: "global",
  blog_newsletter: "blog",
  field_notes_newsletter: "field_notes",
  product_update: "product_updates",
  feature_announcement: "product_updates",
  reengagement: "reengagement",
  pmf_threshold_alert: "global",
  pmf_daily_digest: "global",
  pmf_weekly_digest: "global",
  inbox_connection_down: "global",
  // Onboarding drip — see specs/2026-05-27-onboarding-drip-design.md §6.
  // All on 'global' suppression list per decision log #7: founder-drip
  // unsubscribe = full opt-out signal.
  onboarding_day_0_welcome: "global",
  onboarding_day_1_no_project: "global",
  onboarding_day_1_has_project: "global",
  onboarding_day_3_inbox: "global",
  onboarding_day_4_no_notification: "global",
  onboarding_day_4_has_notification: "global",
  onboarding_day_8_estimates: "global",
  onboarding_day_14_quiet: "global",
  onboarding_day_14_active: "global",
  onboarding_lost_you: "global",
};
