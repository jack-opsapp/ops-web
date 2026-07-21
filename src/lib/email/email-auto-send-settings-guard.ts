import "server-only";

import { PhaseCCategoryAutonomy } from "@/lib/api/services/phase-c-category-autonomy-service";
import { allowedLevelsFor } from "@/lib/email/phase-c-category-autonomy-policy";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadAutonomyLevel,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";

const PRIMARY_CATEGORIES = new Set<string>(EMAIL_THREAD_CATEGORIES);

type Settings = Record<string, unknown>;

export type AutoSendTransitionDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "not_graduated" | "invalid_category" | "category_required";
      sampleSize: number;
      approvalRate: number;
      categoryKey?: string;
    };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function autonomouslySends(level: unknown): boolean {
  return level === "auto_send" || level === "auto_follow_up";
}

/**
 * Gate only transitions into auto-send. The canonical accuracy ledger contains
 * human-finalized operator outcomes and excludes autonomous sends.
 */
export async function validateAutoSendSettingsTransition({
  companyId,
  connectionId,
  actorUserId,
  currentSettings,
  requestedSettings,
}: {
  companyId: string;
  connectionId: string;
  actorUserId: string;
  currentSettings: Settings;
  requestedSettings: Settings;
}): Promise<AutoSendTransitionDecision> {
  if (requestedSettings.enabled === false) return { allowed: true };

  const requestedMap = object(requestedSettings.category_autonomy);
  let acceptedExactCategory = false;
  for (const [categoryKey, requestedLevel] of Object.entries(requestedMap)) {
    if (categoryKey.startsWith("primary:")) {
      const category = categoryKey.slice("primary:".length);
      if (
        !PRIMARY_CATEGORIES.has(category) ||
        typeof requestedLevel !== "string" ||
        !allowedLevelsFor(category as EmailThreadCategory).includes(
          requestedLevel as EmailThreadAutonomyLevel
        )
      ) {
        return {
          allowed: false,
          reason: "invalid_category",
          categoryKey,
          sampleSize: 0,
          approvalRate: 0,
        };
      }
      if (!autonomouslySends(requestedLevel)) continue;
      const status = await PhaseCCategoryAutonomy.isGraduated(
        companyId,
        connectionId,
        actorUserId,
        category as EmailThreadCategory
      );
      if (!status.ready) {
        return {
          allowed: false,
          reason: "not_graduated",
          categoryKey,
          sampleSize: status.sampleSize,
          approvalRate: status.approvalRate,
        };
      }
      acceptedExactCategory = true;
      continue;
    }

    if (!autonomouslySends(requestedLevel)) continue;

    return {
      allowed: false,
      reason: "invalid_category",
      categoryKey,
      sampleSize: 0,
      approvalRate: 0,
    };
  }

  if (
    requestedSettings.enabled === true &&
    currentSettings.enabled !== true &&
    !acceptedExactCategory
  ) {
    return {
      allowed: false,
      reason: "category_required",
      sampleSize: 0,
      approvalRate: 0,
    };
  }

  return { allowed: true };
}
