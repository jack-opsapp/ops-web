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
  // SPEC engagement templates (Phase 1) — all operational/transactional;
  // unsubscribe from these only via the global list (which kills everything),
  // since the recipient asking to silence transactional notices is asking us
  // to stop entirely. Retainer offers and other commercial SPEC sends arrive
  // in Phase 2 and will carry per-list values then.
  "spec.owner_approval_required": "global",
  "spec.owner_approval_granted": "global",
  "spec.owner_approval_declined": "global",
  "spec.deposit_confirmed": "global",
  "spec.quebec_rejected_post_stripe": "global",
  "spec.intake_reminder_1": "global",
  "spec.intake_reminder_2": "global",
  "spec.intake_reminder_3": "global",
  "spec.intake_completed_customer": "global",
  "spec.intake_completed_no_discovery_1": "global",
  "spec.intake_completed_no_discovery_2": "global",
  "spec.intake_completed_no_discovery_3": "global",
  "spec.scope_doc_ready": "global",
  "spec.scope_doc_signed_customer": "global",
  "spec.p2_invoice": "global",
  "spec.p3_invoice": "global",
  "spec.p4_invoice": "global",
  "spec.support_window_open": "global",
  "spec.refund_processed": "global",
  "spec.refund_denied": "global",
};
