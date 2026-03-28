import type { LifecycleEmailMeta, LifecycleStage } from "./types";

/** Human-readable metadata for all 11 lifecycle email types. */
export const LIFECYCLE_EMAIL_META: LifecycleEmailMeta[] = [
  // ── No Onboarding ──
  {
    key: "no_onboarding_day1",
    label: "Day 1 — Haven't Onboarded",
    stage: "no_onboarding",
    description: "Sent 1 day after signup if onboarding is incomplete.",
    audience: "Account holders who signed up but never finished onboarding.",
  },
  {
    key: "no_onboarding_day3",
    label: "Day 3 — Still Haven't Onboarded",
    stage: "no_onboarding",
    description: "Follow-up 3 days after signup if onboarding is still incomplete.",
    audience: "Account holders who signed up but never finished onboarding.",
  },

  // ── No First Project ──
  {
    key: "no_first_project_day2",
    label: "Day 2 — No First Project",
    stage: "no_first_project",
    description: "Sent 2 days after onboarding if no project has been created.",
    audience: "Account holders who completed onboarding but haven't added a project.",
  },
  {
    key: "no_first_project_day5",
    label: "Day 5 — Still No Project",
    stage: "no_first_project",
    description: "Follow-up 5 days after onboarding if still no project.",
    audience: "Account holders who completed onboarding but haven't added a project.",
  },

  // ── Inactive ──
  {
    key: "inactive_14d",
    label: "14 Days Inactive",
    stage: "inactive",
    description: "Sent after 14 days of no activity.",
    audience: "Active/trial account holders who haven't opened the app in 2 weeks.",
  },
  {
    key: "inactive_30d",
    label: "30 Days Inactive",
    stage: "inactive",
    description: "Sent after 30 days of no activity.",
    audience: "Active/trial account holders who haven't opened the app in a month.",
  },

  // ── Trial Expiring ──
  {
    key: "trial_expiring_7d",
    label: "7 Days Before Trial Ends",
    stage: "trial_expiring",
    description: "Sent when trial has 6-8 days remaining.",
    audience: "Trial users approaching their trial end date.",
  },
  {
    key: "trial_expiring_3d",
    label: "3 Days Before Trial Ends",
    stage: "trial_expiring",
    description: "Sent when trial has 2-4 days remaining.",
    audience: "Trial users whose trial is about to expire.",
  },

  // ── Trial Expired ──
  {
    key: "trial_expired_day1",
    label: "Day 1 After Trial Expired",
    stage: "trial_expired",
    description: "Sent 1 day after trial expiration.",
    audience: "Users whose trial just ended.",
  },
  {
    key: "trial_expired_day3",
    label: "Day 3 After Trial Expired",
    stage: "trial_expired",
    description: "Sent 3 days after trial expiration.",
    audience: "Users whose trial ended a few days ago.",
  },
  {
    key: "trial_expired_day7",
    label: "Day 7 After Trial Expired",
    stage: "trial_expired",
    description: "Final check-in 7 days after trial expiration.",
    audience: "Users whose trial ended a week ago — last lifecycle email.",
  },
];

/** Stage labels for grouping in the UI. */
export const STAGE_LABELS: Record<LifecycleStage, string> = {
  no_onboarding: "No Onboarding",
  no_first_project: "No First Project",
  inactive: "Inactive",
  trial_expiring: "Trial Expiring",
  trial_expired: "Trial Expired",
};

/** Ordered stages for rendering. */
export const STAGE_ORDER: LifecycleStage[] = [
  "no_onboarding",
  "no_first_project",
  "inactive",
  "trial_expiring",
  "trial_expired",
];
