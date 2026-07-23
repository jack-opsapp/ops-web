import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendOneSignalPush,
  type SendPushParams,
  type SendPushResult,
} from "@/lib/integrations/onesignal";

interface UnassignedLeadAssignmentDeliveryClaim {
  delivery_id: string;
  delivery_lease_token: string | null;
  company_id: string;
  opportunity_id: string;
  recipient_user_id: string;
  notification_id: string | null;
  lead_title: string;
  should_push: boolean;
  requires_notification: boolean;
  disposition: string;
}

interface DeliveryCompletionResult {
  suppressed?: boolean;
}

interface DeliveryFailureResult {
  terminal?: boolean;
}

export interface UnassignedLeadAssignmentDeliveryWorkerOptions {
  limit?: number;
  leaseSeconds?: number;
  workerId?: string;
}

export interface UnassignedLeadAssignmentDeliveryWorkerResult {
  claimed: number;
  consumed: number;
  delivered: number;
  pushed: number;
  pushSuppressed: number;
  requeued: number;
  terminalFailed: number;
  errors: Array<{ deliveryId: string; message: string }>;
}

export interface UnassignedLeadAssignmentDeliveryDependencies {
  sendPush(params: SendPushParams): Promise<SendPushResult>;
  randomUUID(): string;
}

const DEFAULT_DEPENDENCIES: UnassignedLeadAssignmentDeliveryDependencies = {
  sendPush: sendOneSignalPush,
  randomUUID,
};

const MAX_PUSH_BODY_LENGTH = 50;
const PUSH_BODY_PREFIX = "Assign ";

function truncateWithoutSplittingUnicode(value: string, maxLength: number) {
  let truncated = "";
  for (const character of value) {
    if (truncated.length + character.length > maxLength) break;
    truncated += character;
  }
  return truncated.trimEnd();
}

export function buildUnassignedLeadAssignmentPushBody(
  leadTitle: string
): string {
  const normalized = leadTitle.replace(/\s+/g, " ").trim() || "new lead";
  const full = `${PUSH_BODY_PREFIX}${normalized}`;
  if (full.length <= MAX_PUSH_BODY_LENGTH) return full;

  const available = MAX_PUSH_BODY_LENGTH - PUSH_BODY_PREFIX.length - 1;
  return `${PUSH_BODY_PREFIX}${truncateWithoutSplittingUnicode(
    normalized,
    available
  )}…`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown delivery error";
  }
}

function providerError(result: Extract<SendPushResult, { ok: false }>): string {
  return `OneSignal push failed${
    result.status ? ` (${result.status})` : ""
  }: ${errorMessage(result.error)}`;
}

function isRetryableProviderFailure(
  result: Extract<SendPushResult, { ok: false }>
): boolean {
  const status = result.status;
  if (status === undefined) return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function assertClaim(
  value: unknown
): asserts value is UnassignedLeadAssignmentDeliveryClaim {
  if (!value || typeof value !== "object") {
    throw new Error("Unassigned lead assignment claim was not an object");
  }
  const claim = value as Record<string, unknown>;
  for (const key of [
    "delivery_id",
    "company_id",
    "opportunity_id",
    "recipient_user_id",
    "lead_title",
    "disposition",
  ]) {
    if (typeof claim[key] !== "string" || claim[key] === "") {
      throw new Error(`Unassigned lead assignment claim is missing ${key}`);
    }
  }
  if (
    typeof claim.should_push !== "boolean" ||
    typeof claim.requires_notification !== "boolean"
  ) {
    throw new Error(
      "Unassigned lead assignment claim has invalid channel flags"
    );
  }
  if (
    claim.requires_notification &&
    (typeof claim.delivery_lease_token !== "string" ||
      claim.delivery_lease_token === "" ||
      typeof claim.notification_id !== "string" ||
      claim.notification_id === "")
  ) {
    throw new Error(
      "Visible unassigned lead assignment claim is missing delivery proof"
    );
  }
}

async function persistFailure(params: {
  db: SupabaseClient;
  deliveryId: string;
  leaseToken: string;
  message: string;
  retryable: boolean;
}): Promise<boolean> {
  const { data, error } = await params.db.rpc(
    "fail_unassigned_lead_assignment_delivery",
    {
      p_delivery_id: params.deliveryId,
      p_lease_token: params.leaseToken,
      p_error: params.message,
      p_retryable: params.retryable,
    }
  );
  if (error) {
    throw new Error(
      `Failed to persist unassigned lead assignment delivery failure: ${error.message}`
    );
  }
  return Boolean((data as DeliveryFailureResult | null)?.terminal);
}

export const UnassignedLeadAssignmentDeliveryService = {
  async processBatch(
    db: SupabaseClient,
    options: UnassignedLeadAssignmentDeliveryWorkerOptions = {},
    dependencies?: Partial<UnassignedLeadAssignmentDeliveryDependencies>
  ): Promise<UnassignedLeadAssignmentDeliveryWorkerResult> {
    const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
    const workerId = options.workerId ?? deps.randomUUID();
    const limit = Math.max(0, Math.min(Math.floor(options.limit ?? 25), 100));
    const leaseSeconds = Math.max(
      30,
      Math.min(Math.floor(options.leaseSeconds ?? 180), 900)
    );

    const { data, error } = await db.rpc(
      "claim_unassigned_lead_assignment_deliveries",
      {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      }
    );
    if (error) {
      throw new Error(
        `Failed to claim unassigned lead assignment deliveries: ${error.message}`
      );
    }

    const claims = (data ?? []) as unknown[];
    const result: UnassignedLeadAssignmentDeliveryWorkerResult = {
      claimed: claims.length,
      consumed: 0,
      delivered: 0,
      pushed: 0,
      pushSuppressed: 0,
      requeued: 0,
      terminalFailed: 0,
      errors: [],
    };

    for (const rawClaim of claims) {
      assertClaim(rawClaim);
      const claim = rawClaim;

      if (!claim.requires_notification) {
        if (claim.disposition === "terminal_failure") {
          result.terminalFailed += 1;
        } else {
          result.consumed += 1;
        }
        continue;
      }

      const leaseToken = claim.delivery_lease_token as string;
      let pushState: "sent" | "suppressed" = "suppressed";

      if (claim.should_push) {
        let pushResult: SendPushResult;
        try {
          pushResult = await deps.sendPush({
            recipientUserIds: [claim.recipient_user_id],
            title: "Lead needs an owner",
            body: buildUnassignedLeadAssignmentPushBody(claim.lead_title),
            data: {
              leadId: claim.opportunity_id,
              screen: "leadDetails",
              type: "lead_assignment_required",
            },
            idempotencyKey: claim.delivery_id,
          });
        } catch (pushError) {
          pushResult = { ok: false, error: pushError };
        }

        if (!pushResult.ok) {
          const message = providerError(pushResult);
          try {
            const terminal = await persistFailure({
              db,
              deliveryId: claim.delivery_id,
              leaseToken,
              message,
              retryable: isRetryableProviderFailure(pushResult),
            });
            if (terminal) result.terminalFailed += 1;
            else result.requeued += 1;
          } catch (failurePersistenceError) {
            result.errors.push({
              deliveryId: claim.delivery_id,
              message: `${message}; ${errorMessage(failurePersistenceError)}`,
            });
            continue;
          }
          result.errors.push({ deliveryId: claim.delivery_id, message });
          continue;
        }

        pushState = "sent";
        result.pushed += 1;
      } else {
        result.pushSuppressed += 1;
      }

      const { data: completion, error: completionError } = await db.rpc(
        "complete_unassigned_lead_assignment_delivery",
        {
          p_delivery_id: claim.delivery_id,
          p_lease_token: leaseToken,
          p_push_state: pushState,
        }
      );

      if (!completionError) {
        if ((completion as DeliveryCompletionResult | null)?.suppressed) {
          result.consumed += 1;
        } else {
          result.delivered += 1;
        }
        continue;
      }

      const message = `Unassigned lead assignment delivery completion failed: ${completionError.message}`;
      try {
        const terminal = await persistFailure({
          db,
          deliveryId: claim.delivery_id,
          leaseToken,
          message,
          retryable: true,
        });
        if (terminal) result.terminalFailed += 1;
        else result.requeued += 1;
      } catch (failurePersistenceError) {
        result.errors.push({
          deliveryId: claim.delivery_id,
          message: `${message}; ${errorMessage(failurePersistenceError)}`,
        });
        continue;
      }
      result.errors.push({ deliveryId: claim.delivery_id, message });
    }

    return result;
  },
};
