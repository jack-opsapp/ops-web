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

function useNew(): boolean {
  return process.env.EMAIL_PMF_NEW_TEMPLATES === "true";
}

export function thresholdAlertEmail(props: ThresholdAlertProps) {
  if (useNew()) {
    return <PmfThresholdAlert {...props} />;
  }
  return <LegacyThresholdAlertEmail {...props} />;
}

export function dailyDigestEmail(props: DailyDigestProps) {
  if (useNew()) {
    return <PmfDailyDigest {...props} />;
  }
  return <LegacyDailyDigestEmail {...props} />;
}

export function weeklyDigestEmail(props: WeeklyDigestProps) {
  if (useNew()) {
    return <PmfWeeklyDigest {...props} />;
  }
  return <LegacyWeeklyDigestEmail {...props} />;
}
