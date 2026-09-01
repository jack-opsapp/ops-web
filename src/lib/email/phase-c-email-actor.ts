import "server-only";

import { types as nodeTypes } from "node:util";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveEmailOpportunityAccess,
  type EmailOpportunityOperation,
} from "@/lib/email/email-opportunity-access";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINAL_ACTOR_FENCE_RPC =
  "read_phase_c_routed_actor_fence_as_system" as const;
const MAX_PROVIDER_THREAD_ID_BYTES = 512;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const FINAL_ACTOR_FENCE_ROW_KEYS = [
  "actor_user_id",
  "company_id",
  "connection_id",
  "opportunity_id",
  "internal_thread_id",
  "provider_thread_id",
  "assignment_version",
  "connection_type",
  "connection_provider",
  "connection_email",
] as const;
const REQUIRED_INPUT_KEYS = [
  "companyId",
  "connectionId",
  "opportunityId",
  "internalThreadId",
  "providerThreadId",
] as const;
const OPTIONAL_INPUT_KEYS = [
  "expectedAssignmentVersion",
  "operation",
  "opportunityAction",
] as const;
const ALLOWED_INPUT_KEYS = new Set<string>([
  ...REQUIRED_INPUT_KEYS,
  ...OPTIONAL_INPUT_KEYS,
]);

export type PhaseCEmailActorNoWorkReason =
  | "invalid_identifiers"
  | "connection_not_found"
  | "connection_cross_company"
  | "connection_inactive"
  | "opportunity_required"
  | "opportunity_not_found"
  | "opportunity_cross_company"
  | "opportunity_unassigned"
  | "assignment_contract_unavailable"
  | "assignment_stale"
  | "personal_connection_owner_missing"
  | "personal_owner_not_assignee"
  | "actor_identity_invalid"
  | "actor_not_found"
  | "actor_cross_company"
  | "actor_inactive"
  | "lead_thread_unauthorized"
  | "lookup_failed";

export interface PhaseCEmailActorContext {
  actorUserId: string;
  assignmentVersion: number;
  assignmentEventId: string | null;
  companyId: string;
  connectionId: string;
  opportunityId: string;
  internalThreadId: string;
  providerThreadId: string;
  connectionType: "company" | "individual";
  actorNameSnapshot: string | null;
  actorEmailSnapshot: string | null;
  clientFacingAddressSnapshot: string;
}

const RESOLVED_PHASE_C_EMAIL_ACTOR_CONTEXTS = new WeakSet<object>();

/**
 * Runtime proof that the routed actor/job/mailbox intersection came from this
 * module's complete canonical resolver. Structural copies deliberately lose
 * authority so IDs cannot be promoted into background service access.
 */
export function isResolvedPhaseCEmailActorContext(
  value: unknown
): value is PhaseCEmailActorContext {
  return (
    typeof value === "object" &&
    value !== null &&
    RESOLVED_PHASE_C_EMAIL_ACTOR_CONTEXTS.has(value)
  );
}

export type PhaseCEmailActorResolution =
  | { kind: "resolved"; context: PhaseCEmailActorContext }
  | {
      kind: "no_work";
      reason: PhaseCEmailActorNoWorkReason;
      authorizationReason?: string;
    };

interface PhaseCEmailAuthorizationInput {
  actorUserId: string;
  companyId: string;
  connectionId: string;
  opportunityId: string;
  internalThreadId: string;
  providerThreadId: string;
  operation: Extract<EmailOpportunityOperation, "read" | "edit" | "send">;
  opportunityAction: "view" | "edit" | "convert" | null;
  supabase: SupabaseClient;
}

type PhaseCEmailAuthorizationResolver = (
  input: PhaseCEmailAuthorizationInput
) => Promise<{ allowed: true } | { allowed: false; reason: string }>;

export interface ResolvePhaseCEmailActorInput {
  companyId: string;
  connectionId: string;
  opportunityId: string | null;
  internalThreadId: string;
  providerThreadId: string;
  expectedAssignmentVersion?: number | null;
  /** Email-side permission intersection required by the pending work. */
  operation?: Extract<EmailOpportunityOperation, "read" | "edit" | "send">;
  /** Optional stricter lead action, such as conversion review. */
  opportunityAction?: "view" | "edit" | "convert";
}

interface PhaseCEmailActorInputSnapshot {
  readonly companyId: string;
  readonly connectionId: string;
  readonly opportunityId: string | null;
  readonly internalThreadId: string;
  readonly providerThreadId: string;
  readonly expectedAssignmentVersion: number | null;
  readonly operation: Extract<
    EmailOpportunityOperation,
    "read" | "edit" | "send"
  >;
  readonly opportunityAction: "view" | "edit" | "convert" | null;
}

interface EmailConnectionRow {
  id: string;
  company_id: string;
  provider: string;
  type: "company" | "individual";
  user_id: string | null;
  email: string;
  status: string | null;
  sync_enabled: boolean | null;
}

interface OpportunityRow {
  id: string;
  company_id: string;
  assigned_to: string | null;
  assignment_version: number | string | null;
}

interface UserRow {
  id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
}

interface AssignmentEventRow {
  id: string;
}

interface FinalActorFence {
  readonly actorUserId: string;
  readonly assignmentVersion: number;
  readonly companyId: string;
  readonly connectionId: string;
  readonly opportunityId: string;
  readonly internalThreadId: string;
  readonly providerThreadId: string;
  readonly connectionType: "company" | "individual";
  readonly connectionProvider: "gmail" | "microsoft365";
  readonly connectionEmail: string;
}

type FinalActorFenceDecode =
  | { readonly kind: "matched"; readonly fence: FinalActorFence }
  | { readonly kind: "stale" }
  | { readonly kind: "invalid" };

function noWork(
  reason: PhaseCEmailActorNoWorkReason,
  authorizationReason?: string
): PhaseCEmailActorResolution {
  return authorizationReason
    ? { kind: "no_work", reason, authorizationReason }
    : { kind: "no_work", reason };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEmailProvider(value: unknown): value is "gmail" | "microsoft365" {
  return value === "gmail" || value === "microsoft365";
}

function isCanonicalProviderThreadId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    new TextEncoder().encode(value).byteLength <=
      MAX_PROVIDER_THREAD_ID_BYTES &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function postgresBtrim(value: string): string {
  return value.replace(/^ +| +$/gu, "");
}

function exactOwnDataValues(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  try {
    if (nodeTypes.isProxy(value)) return null;

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== "string") ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
    ) {
      return null;
    }

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function decodeFinalActorFence(
  raw: unknown,
  expected: Readonly<{
    actorUserId: string;
    assignmentVersion: number;
    companyId: string;
    connectionId: string;
    opportunityId: string;
    internalThreadId: string;
    providerThreadId: string;
    connectionProvider: "gmail" | "microsoft365";
  }>
): FinalActorFenceDecode {
  if (!Array.isArray(raw)) return { kind: "invalid" };

  let row: unknown;
  try {
    if (nodeTypes.isProxy(raw)) return { kind: "invalid" };

    const descriptors = Object.getOwnPropertyDescriptors(raw);
    const descriptorRecord = descriptors as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const keys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptorRecord.length;
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.enumerable ||
      (lengthDescriptor.value !== 0 && lengthDescriptor.value !== 1)
    ) {
      return { kind: "invalid" };
    }

    if (lengthDescriptor.value === 0) {
      return keys.length === 1 && Object.hasOwn(descriptors, "length")
        ? { kind: "stale" }
        : { kind: "invalid" };
    }

    const rowDescriptor = descriptorRecord["0"];
    if (
      keys.length !== 2 ||
      !Object.hasOwn(descriptors, "length") ||
      !rowDescriptor ||
      !("value" in rowDescriptor) ||
      !rowDescriptor.enumerable
    ) {
      return { kind: "invalid" };
    }
    row = rowDescriptor.value;
  } catch {
    return { kind: "invalid" };
  }

  const values = exactOwnDataValues(row, FINAL_ACTOR_FENCE_ROW_KEYS);
  const assignmentVersion = parseAssignmentVersion(values?.assignment_version);
  if (
    !values ||
    !isUuid(values.actor_user_id) ||
    !isUuid(values.company_id) ||
    !isUuid(values.connection_id) ||
    !isUuid(values.opportunity_id) ||
    !isUuid(values.internal_thread_id) ||
    !isCanonicalProviderThreadId(values.provider_thread_id) ||
    assignmentVersion === null ||
    (values.connection_type !== "company" &&
      values.connection_type !== "individual") ||
    !isEmailProvider(values.connection_provider) ||
    !isNonEmpty(values.connection_email) ||
    values.actor_user_id !== expected.actorUserId ||
    assignmentVersion !== expected.assignmentVersion ||
    values.company_id !== expected.companyId ||
    values.connection_id !== expected.connectionId ||
    values.opportunity_id !== expected.opportunityId ||
    values.internal_thread_id !== expected.internalThreadId ||
    values.provider_thread_id !== expected.providerThreadId ||
    values.connection_provider !== expected.connectionProvider
  ) {
    return { kind: "invalid" };
  }

  return {
    kind: "matched",
    fence: Object.freeze({
      actorUserId: values.actor_user_id,
      assignmentVersion,
      companyId: values.company_id,
      connectionId: values.connection_id,
      opportunityId: values.opportunity_id,
      internalThreadId: values.internal_thread_id,
      providerThreadId: values.provider_thread_id,
      connectionType: values.connection_type,
      connectionProvider: values.connection_provider,
      connectionEmail: values.connection_email.trim(),
    }),
  };
}

function snapshotInput(input: unknown): PhaseCEmailActorInputSnapshot | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  try {
    if (nodeTypes.isProxy(input)) return null;

    const descriptors = Object.getOwnPropertyDescriptors(input);
    const descriptorRecord = descriptors as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        (key) => typeof key !== "string" || !ALLOWED_INPUT_KEYS.has(key)
      ) ||
      REQUIRED_INPUT_KEYS.some((key) => !Object.hasOwn(descriptors, key))
    ) {
      return null;
    }

    const values = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptorRecord[key];
      if (
        typeof key !== "string" ||
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }
      values[key] = descriptor.value;
    }

    const companyId = values.companyId;
    const connectionId = values.connectionId;
    const opportunityId = values.opportunityId;
    const internalThreadId = values.internalThreadId;
    const providerThreadId = values.providerThreadId;
    const expectedAssignmentVersion = values.expectedAssignmentVersion;
    const operation = values.operation;
    const opportunityAction = values.opportunityAction;
    if (
      !isUuid(companyId) ||
      !isUuid(connectionId) ||
      (opportunityId !== null && !isUuid(opportunityId)) ||
      !isUuid(internalThreadId) ||
      !isCanonicalProviderThreadId(providerThreadId) ||
      (expectedAssignmentVersion !== undefined &&
        expectedAssignmentVersion !== null &&
        (!Number.isSafeInteger(expectedAssignmentVersion) ||
          (expectedAssignmentVersion as number) < 0)) ||
      (operation !== undefined &&
        operation !== "read" &&
        operation !== "edit" &&
        operation !== "send") ||
      (opportunityAction !== undefined &&
        opportunityAction !== "view" &&
        opportunityAction !== "edit" &&
        opportunityAction !== "convert")
    ) {
      return null;
    }

    return Object.freeze({
      companyId,
      connectionId,
      opportunityId,
      internalThreadId,
      providerThreadId,
      expectedAssignmentVersion:
        expectedAssignmentVersion === undefined
          ? null
          : (expectedAssignmentVersion as number | null),
      operation: (operation ??
        "send") as PhaseCEmailActorInputSnapshot["operation"],
      opportunityAction: (opportunityAction ??
        null) as PhaseCEmailActorInputSnapshot["opportunityAction"],
    });
  } catch {
    return null;
  }
}

function parseAssignmentVersion(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && /^\d+$/.test(value))
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function actorNameSnapshot(user: UserRow): string | null {
  const name = [user.first_name, user.last_name]
    .filter((part): part is string => isNonEmpty(part))
    .map((part) => part.trim())
    .join(" ");
  return name || null;
}

const authorizeWithCanonicalAccess: PhaseCEmailAuthorizationResolver = async (
  input
) => {
  const decision = await resolveEmailOpportunityAccess({
    actor: { userId: input.actorUserId, companyId: input.companyId },
    operation: input.operation,
    threadId: input.internalThreadId,
    connectionId: input.connectionId,
    providerThreadId: input.providerThreadId,
    opportunityId: input.opportunityId,
    supabase: input.supabase,
  });
  if (!decision.allowed) return { allowed: false, reason: decision.reason };

  if (input.opportunityAction) {
    const { data, error } = await input.supabase.rpc(
      "authorize_opportunity_action_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_opportunity_id: input.opportunityId,
        p_action: input.opportunityAction,
      }
    );
    if (error || data !== true) {
      return {
        allowed: false,
        reason: error ? "opportunity_authorization_failed" : "access_denied",
      };
    }
  }

  return { allowed: true };
};

/**
 * Resolve the only OPS user Phase C may act as for a lead-bound email action.
 * Mailbox addresses are retained as client-facing snapshots only; they never
 * participate in actor or assignment identity.
 */
export async function resolvePhaseCEmailActor(
  input: ResolvePhaseCEmailActorInput
): Promise<PhaseCEmailActorResolution> {
  try {
    const snapshot = snapshotInput(input);
    if (!snapshot) return noWork("invalid_identifiers");
    if (snapshot.opportunityId === null) return noWork("opportunity_required");

    const db = getServiceRoleClient() as unknown as SupabaseClient;
    const { data: connectionData, error: connectionError } = await db
      .from("email_connections")
      .select(
        "id, company_id, provider, type, user_id, email, status, sync_enabled"
      )
      .eq("id", snapshot.connectionId)
      .maybeSingle();
    if (connectionError) return noWork("lookup_failed");
    const connection = connectionData as EmailConnectionRow | null;
    if (!connection) return noWork("connection_not_found");
    if (!isUuid(connection.id) || connection.id !== snapshot.connectionId) {
      return noWork("lookup_failed");
    }
    if (connection.company_id !== snapshot.companyId) {
      return noWork("connection_cross_company");
    }
    if (connection.status !== "active" || connection.sync_enabled === false) {
      return noWork("connection_inactive");
    }
    if (
      (connection.type !== "company" && connection.type !== "individual") ||
      !isEmailProvider(connection.provider) ||
      !isNonEmpty(connection.email)
    ) {
      return noWork("lookup_failed");
    }

    const { data: opportunityData, error: opportunityError } = await db
      .from("opportunities")
      .select("id, company_id, assigned_to, assignment_version")
      .eq("id", snapshot.opportunityId)
      .is("deleted_at", null)
      .maybeSingle();
    if (opportunityError) return noWork("lookup_failed");
    const opportunity = opportunityData as OpportunityRow | null;
    if (!opportunity) return noWork("opportunity_not_found");
    if (!isUuid(opportunity.id) || opportunity.id !== snapshot.opportunityId) {
      return noWork("lookup_failed");
    }
    if (opportunity.company_id !== snapshot.companyId) {
      return noWork("opportunity_cross_company");
    }
    if (!opportunity.assigned_to) {
      return noWork("opportunity_unassigned");
    }

    const assignmentVersion = parseAssignmentVersion(
      opportunity.assignment_version
    );
    if (assignmentVersion === null) {
      return noWork("assignment_contract_unavailable");
    }
    if (
      snapshot.expectedAssignmentVersion != null &&
      snapshot.expectedAssignmentVersion !== assignmentVersion
    ) {
      return noWork("assignment_stale");
    }

    let actorUserId = opportunity.assigned_to;
    if (connection.type === "individual") {
      if (typeof connection.user_id !== "string") {
        return noWork("personal_connection_owner_missing");
      }
      const connectionOwnerUserId = postgresBtrim(connection.user_id);
      if (connectionOwnerUserId.length === 0) {
        return noWork("personal_connection_owner_missing");
      }
      if (!isUuid(connectionOwnerUserId)) {
        return noWork("actor_identity_invalid");
      }
      if (connectionOwnerUserId !== opportunity.assigned_to) {
        return noWork("personal_owner_not_assignee");
      }
      actorUserId = connectionOwnerUserId;
    }
    if (!isUuid(actorUserId)) return noWork("actor_identity_invalid");

    const { data: actorData, error: actorError } = await db
      .from("users")
      .select(
        "id, company_id, first_name, last_name, email, is_active, deleted_at"
      )
      .eq("id", actorUserId)
      .maybeSingle();
    if (actorError) return noWork("lookup_failed");
    const actor = actorData as UserRow | null;
    if (!actor) return noWork("actor_not_found");
    if (!isUuid(actor.id) || actor.id !== actorUserId) {
      return noWork("lookup_failed");
    }
    if (actor.company_id !== snapshot.companyId) {
      return noWork("actor_cross_company");
    }
    if (actor.is_active !== true || actor.deleted_at !== null) {
      return noWork("actor_inactive");
    }

    const initialConnectionId = connection.id;
    const initialConnectionProvider = connection.provider;
    const initialOpportunityId = opportunity.id;
    const actorName = actorNameSnapshot(actor);
    const actorEmail = isNonEmpty(actor.email) ? actor.email.trim() : null;

    const authorization = await authorizeWithCanonicalAccess({
      actorUserId,
      companyId: snapshot.companyId,
      connectionId: initialConnectionId,
      opportunityId: initialOpportunityId,
      internalThreadId: snapshot.internalThreadId,
      providerThreadId: snapshot.providerThreadId,
      operation: snapshot.operation,
      opportunityAction: snapshot.opportunityAction,
      supabase: db,
    });
    if (!authorization.allowed) {
      return noWork("lead_thread_unauthorized", authorization.reason);
    }

    const { data: assignmentEventData, error: assignmentEventError } = await db
      .from("opportunity_assignment_events")
      .select("id")
      .eq("company_id", snapshot.companyId)
      .eq("opportunity_id", initialOpportunityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (assignmentEventError) return noWork("lookup_failed");
    const assignmentEvent = assignmentEventData as AssignmentEventRow | null;
    if (assignmentEvent && !isUuid(assignmentEvent.id)) {
      return noWork("lookup_failed");
    }

    // This is the final awaited operation before minting authority. One fixed
    // database statement revalidates the actor, assignment, exact routed
    // thread, and current mailbox/provider semantics together.
    const { data: finalFenceData, error: finalFenceError } = await db.rpc(
      FINAL_ACTOR_FENCE_RPC,
      Object.freeze({
        p_company_id: snapshot.companyId,
        p_connection_id: initialConnectionId,
        p_connection_provider: initialConnectionProvider,
        p_opportunity_id: initialOpportunityId,
        p_actor_user_id: actorUserId,
        p_assignment_version: assignmentVersion,
        p_internal_thread_id: snapshot.internalThreadId,
        p_provider_thread_id: snapshot.providerThreadId,
      })
    );
    if (finalFenceError) return noWork("lookup_failed");
    const finalFence = decodeFinalActorFence(finalFenceData, {
      actorUserId,
      assignmentVersion,
      companyId: snapshot.companyId,
      connectionId: initialConnectionId,
      opportunityId: initialOpportunityId,
      internalThreadId: snapshot.internalThreadId,
      providerThreadId: snapshot.providerThreadId,
      connectionProvider: initialConnectionProvider,
    });
    if (finalFence.kind === "invalid") return noWork("lookup_failed");
    if (finalFence.kind === "stale") {
      return noWork("assignment_stale");
    }

    const context: PhaseCEmailActorContext = {
      actorUserId: finalFence.fence.actorUserId,
      assignmentVersion: finalFence.fence.assignmentVersion,
      assignmentEventId: assignmentEvent?.id ?? null,
      companyId: finalFence.fence.companyId,
      connectionId: finalFence.fence.connectionId,
      opportunityId: finalFence.fence.opportunityId,
      internalThreadId: finalFence.fence.internalThreadId,
      providerThreadId: finalFence.fence.providerThreadId,
      connectionType: finalFence.fence.connectionType,
      actorNameSnapshot: actorName,
      actorEmailSnapshot: actorEmail,
      clientFacingAddressSnapshot: finalFence.fence.connectionEmail,
    };
    RESOLVED_PHASE_C_EMAIL_ACTOR_CONTEXTS.add(context);

    return {
      kind: "resolved",
      context: Object.freeze(context),
    };
  } catch {
    return noWork("lookup_failed");
  }
}
