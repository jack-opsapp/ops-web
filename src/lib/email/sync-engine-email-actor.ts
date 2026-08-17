import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolvePhaseCEmailActor,
  type PhaseCEmailActorResolution,
} from "@/lib/email/phase-c-email-actor";
import type { EmailOpportunityOperation } from "@/lib/email/email-opportunity-access";
import { snapshotExactOwnEnumerableData } from "@/lib/agent-control-plane/actor/exact-own-data-snapshot";

const REQUIRED_INPUT_KEYS = [
  "companyId",
  "connectionId",
  "opportunityId",
  "providerThreadId",
  "operation",
  "supabase",
] as const;
const OPTIONAL_INPUT_KEYS = [
  "opportunityAction",
  "expectedAssignmentVersion",
] as const;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PROVIDER_THREAD_ID_BYTES = 2_048;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export interface ResolveSyncEngineEmailActorInput {
  companyId: string;
  connectionId: string;
  opportunityId: string;
  providerThreadId: string;
  operation: Extract<EmailOpportunityOperation, "read" | "edit" | "send">;
  opportunityAction?: "view" | "edit" | "convert";
  expectedAssignmentVersion?: number | null;
  supabase: SupabaseClient;
}

export type SyncEngineEmailActorResolution =
  | PhaseCEmailActorResolution
  | { kind: "no_work"; reason: "thread_not_found" | "lookup_failed" };

function snapshotInput(
  input: unknown
): Readonly<ResolveSyncEngineEmailActorInput> | null {
  try {
    const values = snapshotExactOwnEnumerableData(
      input,
      REQUIRED_INPUT_KEYS,
      OPTIONAL_INPUT_KEYS
    );
    if (!values) return null;

    const companyId = values.companyId;
    const connectionId = values.connectionId;
    const opportunityId = values.opportunityId;
    const providerThreadId = values.providerThreadId;
    const operation = values.operation;
    const opportunityAction = values.opportunityAction;
    const expectedAssignmentVersion = values.expectedAssignmentVersion;
    const supabase = values.supabase;
    if (
      typeof companyId !== "string" ||
      !CANONICAL_UUID_PATTERN.test(companyId) ||
      typeof connectionId !== "string" ||
      !CANONICAL_UUID_PATTERN.test(connectionId) ||
      typeof opportunityId !== "string" ||
      !CANONICAL_UUID_PATTERN.test(opportunityId) ||
      typeof providerThreadId !== "string" ||
      providerThreadId.length < 1 ||
      providerThreadId.trim() !== providerThreadId ||
      new TextEncoder().encode(providerThreadId).byteLength >
        MAX_PROVIDER_THREAD_ID_BYTES ||
      CONTROL_CHARACTER_PATTERN.test(providerThreadId) ||
      (operation !== "read" && operation !== "edit" && operation !== "send") ||
      (opportunityAction !== undefined &&
        opportunityAction !== "view" &&
        opportunityAction !== "edit" &&
        opportunityAction !== "convert") ||
      (expectedAssignmentVersion !== undefined &&
        expectedAssignmentVersion !== null &&
        (!Number.isSafeInteger(expectedAssignmentVersion) ||
          (expectedAssignmentVersion as number) < 0)) ||
      (typeof supabase !== "object" && typeof supabase !== "function") ||
      supabase === null
    ) {
      return null;
    }

    return Object.freeze({
      companyId,
      connectionId,
      opportunityId,
      providerThreadId,
      operation,
      opportunityAction,
      expectedAssignmentVersion: expectedAssignmentVersion as
        | number
        | null
        | undefined,
      supabase: supabase as SupabaseClient,
    });
  } catch {
    return null;
  }
}

/**
 * Resolve one assigned OPS actor from the exact durable mailbox/thread/lead
 * tuple. A mailbox connector user and an email-address match are never actor
 * evidence. Missing or conflicting linkage returns typed no-work.
 */
export async function resolveSyncEngineEmailActor(
  input: ResolveSyncEngineEmailActorInput
): Promise<SyncEngineEmailActorResolution> {
  try {
    const snapshot = snapshotInput(input);
    if (!snapshot) return { kind: "no_work", reason: "lookup_failed" };

    const { data, error } = await snapshot.supabase
      .from("email_threads")
      .select("id")
      .eq("company_id", snapshot.companyId)
      .eq("connection_id", snapshot.connectionId)
      .eq("provider_thread_id", snapshot.providerThreadId)
      .eq("opportunity_id", snapshot.opportunityId)
      .maybeSingle();
    if (error) return { kind: "no_work", reason: "lookup_failed" };
    const internalThreadId = snapshotExactOwnEnumerableData(data, ["id"])?.id;
    if (data === null) {
      return { kind: "no_work", reason: "thread_not_found" };
    }
    if (
      typeof internalThreadId !== "string" ||
      !CANONICAL_UUID_PATTERN.test(internalThreadId)
    ) {
      return { kind: "no_work", reason: "lookup_failed" };
    }

    return await resolvePhaseCEmailActor({
      companyId: snapshot.companyId,
      connectionId: snapshot.connectionId,
      opportunityId: snapshot.opportunityId,
      internalThreadId,
      providerThreadId: snapshot.providerThreadId,
      expectedAssignmentVersion: snapshot.expectedAssignmentVersion,
      operation: snapshot.operation,
      opportunityAction: snapshot.opportunityAction,
    });
  } catch {
    return { kind: "no_work", reason: "lookup_failed" };
  }
}
