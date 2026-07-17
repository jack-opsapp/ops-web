import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendOneSignalPush,
  type SendPushParams,
  type SendPushResult,
} from "@/lib/integrations/onesignal";

interface OpportunityConversionNotificationClaim {
  delivery_id: string;
  delivery_lease_token: string | null;
  conversion_event_id: string;
  company_id: string;
  opportunity_id: string;
  project_id: string;
  recipient_user_id: string;
  actor_user_id: string | null;
  notification_id: string | null;
  lead_title: string;
  destination: "lead" | "project" | null;
  should_push: boolean;
  requires_notification: boolean;
  disposition: string;
}

interface CompletionResult {
  suppressed?: boolean;
}

interface FailureResult {
  terminal?: boolean;
}

export interface OpportunityConversionNotificationDeliveryOptions {
  limit?: number;
  leaseSeconds?: number;
  workerId?: string;
}

export interface OpportunityConversionNotificationDeliveryResult {
  claimed: number;
  consumed: number;
  delivered: number;
  pushed: number;
  pushSuppressed: number;
  requeued: number;
  terminalFailed: number;
  errors: Array<{ deliveryId: string; message: string }>;
}

export interface OpportunityConversionNotificationDeliveryDependencies {
  sendPush(params: SendPushParams): Promise<SendPushResult>;
  randomUUID(): string;
}

const DEFAULT_DEPENDENCIES: OpportunityConversionNotificationDeliveryDependencies =
  {
    sendPush: sendOneSignalPush,
    randomUUID,
  };

const MAX_PUSH_BODY_LENGTH = 50;

export function buildOpportunityConversionPushBody(leadTitle: string): string {
  const normalized = leadTitle.replace(/\s+/g, " ").trim() || "Lead";
  const full = `${normalized} is now a project.`;
  if (full.length <= MAX_PUSH_BODY_LENGTH) return full;
  return `${full.slice(0, MAX_PUSH_BODY_LENGTH - 1).trimEnd()}…`;
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
): asserts value is OpportunityConversionNotificationClaim {
  if (!value || typeof value !== "object") {
    throw new Error("Conversion notification delivery claim was not an object");
  }
  const claim = value as Record<string, unknown>;
  for (const key of [
    "delivery_id",
    "conversion_event_id",
    "company_id",
    "opportunity_id",
    "project_id",
    "recipient_user_id",
    "lead_title",
    "disposition",
  ]) {
    if (typeof claim[key] !== "string" || claim[key] === "") {
      throw new Error(`Conversion notification claim is missing ${key}`);
    }
  }
  if (claim.actor_user_id !== null && typeof claim.actor_user_id !== "string") {
    throw new Error("Conversion notification claim has an invalid actor");
  }
  if (
    typeof claim.should_push !== "boolean" ||
    typeof claim.requires_notification !== "boolean"
  ) {
    throw new Error("Conversion notification claim has invalid channel flags");
  }
  if (
    claim.requires_notification &&
    (typeof claim.delivery_lease_token !== "string" ||
      typeof claim.notification_id !== "string" ||
      (claim.destination !== "lead" && claim.destination !== "project"))
  ) {
    throw new Error("Visible conversion notification claim is missing proof");
  }
}

async function persistFailure(params: {
  db: SupabaseClient;
  deliveryId: string;
  leaseToken: string;
  error: string;
  retryable: boolean;
}): Promise<boolean> {
  const { data, error } = await params.db.rpc(
    "fail_opportunity_conversion_notification_delivery",
    {
      p_delivery_id: params.deliveryId,
      p_lease_token: params.leaseToken,
      p_error: params.error,
      p_retryable: params.retryable,
    }
  );
  if (error) {
    throw new Error(
      `Failed to persist conversion notification failure: ${error.message}`
    );
  }
  return Boolean((data as FailureResult | null)?.terminal);
}

export const OpportunityConversionNotificationDeliveryService = {
  async processBatch(
    db: SupabaseClient,
    options: OpportunityConversionNotificationDeliveryOptions = {},
    dependencies?: Partial<OpportunityConversionNotificationDeliveryDependencies>
  ): Promise<OpportunityConversionNotificationDeliveryResult> {
    const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
    const limit = Math.max(0, Math.min(Math.floor(options.limit ?? 25), 100));
    const leaseSeconds = Math.max(
      30,
      Math.min(Math.floor(options.leaseSeconds ?? 180), 900)
    );
    const workerId = options.workerId ?? deps.randomUUID();
    const result: OpportunityConversionNotificationDeliveryResult = {
      claimed: 0,
      consumed: 0,
      delivered: 0,
      pushed: 0,
      pushSuppressed: 0,
      requeued: 0,
      terminalFailed: 0,
      errors: [],
    };

    // Claim immediately before each provider call. A slow first delivery can
    // never burn a later row's lease or attempt without processing that row.
    for (let index = 0; index < limit; index += 1) {
      const { data, error } = await db.rpc(
        "claim_opportunity_conversion_notification_deliveries",
        {
          p_worker_id: workerId,
          p_lease_seconds: leaseSeconds,
        }
      );
      if (error) {
        throw new Error(
          `Failed to claim conversion notification delivery: ${error.message}`
        );
      }
      const claims = (data ?? []) as unknown[];
      if (claims.length === 0) break;
      if (claims.length !== 1) {
        throw new Error("Conversion notification claim returned multiple rows");
      }

      assertClaim(claims[0]);
      const claim = claims[0];
      result.claimed += 1;

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
            title: "Lead converted",
            body: buildOpportunityConversionPushBody(claim.lead_title),
            data:
              claim.destination === "project"
                ? {
                    type: "lead_converted",
                    projectId: claim.project_id,
                    opportunityId: claim.opportunity_id,
                    screen: "projectDetails",
                  }
                : {
                    type: "lead_converted",
                    opportunityId: claim.opportunity_id,
                    screen: "leadDetails",
                  },
            idempotencyKey: claim.conversion_event_id,
          });
        } catch (pushError) {
          pushResult = { ok: false, error: pushError };
        }

        if (!pushResult.ok) {
          const failure = providerError(pushResult);
          try {
            const terminal = await persistFailure({
              db,
              deliveryId: claim.delivery_id,
              leaseToken,
              error: failure,
              retryable: isRetryableProviderFailure(pushResult),
            });
            if (terminal) result.terminalFailed += 1;
            else result.requeued += 1;
          } catch (persistError) {
            result.errors.push({
              deliveryId: claim.delivery_id,
              message: `${failure}; ${errorMessage(persistError)}`,
            });
            continue;
          }
          result.errors.push({
            deliveryId: claim.delivery_id,
            message: failure,
          });
          continue;
        }
        pushState = "sent";
        result.pushed += 1;
      } else {
        result.pushSuppressed += 1;
      }

      const { data: completion, error: completeError } = await db.rpc(
        "complete_opportunity_conversion_notification_delivery",
        {
          p_delivery_id: claim.delivery_id,
          p_lease_token: leaseToken,
          p_push_state: pushState,
        }
      );
      if (!completeError) {
        if ((completion as CompletionResult | null)?.suppressed) {
          result.consumed += 1;
        } else {
          result.delivered += 1;
        }
        continue;
      }

      const failure = `Conversion notification completion failed: ${completeError.message}`;
      try {
        const terminal = await persistFailure({
          db,
          deliveryId: claim.delivery_id,
          leaseToken,
          error: failure,
          retryable: true,
        });
        if (terminal) result.terminalFailed += 1;
        else result.requeued += 1;
      } catch (persistError) {
        result.errors.push({
          deliveryId: claim.delivery_id,
          message: `${failure}; ${errorMessage(persistError)}`,
        });
        continue;
      }
      result.errors.push({ deliveryId: claim.delivery_id, message: failure });
    }

    return result;
  },
};
