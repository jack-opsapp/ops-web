/**
 * PMF email bridge — picks between the legacy `src/emails/pmf/*` templates
 * and the new typed templates rendered through OPS layout primitives based
 * on the `EMAIL_PMF_NEW_TEMPLATES` env flag.
 *
 * The flag defaults to `false` (legacy). Set to `"true"` in staging for the
 * bake; flip in production after a one-week soak with no regressions. Once
 * the new templates are confirmed visually equivalent, delete this bridge
 * and the legacy templates in a follow-up PR.
 */
import * as React from "react";
import {
  ThresholdAlertEmail as LegacyThresholdAlertEmail,
  type ThresholdAlertProps,
} from "@/emails/pmf/threshold-alert";
import {
  DailyDigestEmail as LegacyDailyDigestEmail,
  type DailyDigestProps,
} from "@/emails/pmf/daily-digest";
import {
  WeeklyDigestEmail as LegacyWeeklyDigestEmail,
  type WeeklyDigestProps,
} from "@/emails/pmf/weekly-digest";
import { PmfThresholdAlert } from "./react/templates/PmfThresholdAlert";
import { PmfDailyDigest } from "./react/templates/PmfDailyDigest";
import { PmfWeeklyDigest } from "./react/templates/PmfWeeklyDigest";

function shouldUseNewTemplate(): boolean {
  return process.env.EMAIL_PMF_NEW_TEMPLATES === "true";
}

// Each helper invokes the chosen template as a function so callers receive
// a fully-built React element (matching the prior `EmailFn(props)` pattern).
// Wrapping in JSX would defer execution and break existing call-site tests
// that mock the legacy template module to capture props at construction time.

export function thresholdAlertEmail(props: ThresholdAlertProps) {
  return shouldUseNewTemplate()
    ? PmfThresholdAlert(props)
    : LegacyThresholdAlertEmail(props);
}

export function dailyDigestEmail(props: DailyDigestProps) {
  return shouldUseNewTemplate()
    ? PmfDailyDigest(props)
    : LegacyDailyDigestEmail(props);
}

export function weeklyDigestEmail(props: WeeklyDigestProps) {
  return shouldUseNewTemplate()
    ? PmfWeeklyDigest(props)
    : LegacyWeeklyDigestEmail(props);
}
