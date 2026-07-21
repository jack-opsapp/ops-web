import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ProviderApiError,
  ProviderAuthError,
  ProviderScopeError,
} from "./email-provider";

export type EmailProviderMutationKind =
  | "draft_create"
  | "webhook_setup"
  | "webhook_renewal";

export type EmailProviderMutationAttemptStatus =
  | "prepared"
  | "attempting"
  | "provider_rejected"
  | "provider_accepted"
  | "reconciliation_required"
  | "completed";

const DEFAULT_DEFINITIVE_PROVIDER_REJECTION_STATUSES = new Set([
  400, 401, 403, 404, 405, 406, 410, 411, 412, 413, 414, 415, 416, 417, 422,
  424, 426, 428, 431, 451,
]);

export interface EmailProviderMutationAttempt {
  id: string;
  connectionId: string;
  connectionTypeSnapshot: "company" | "individual";
  providerSnapshot: "gmail" | "microsoft365";
  mailboxAddressSnapshot: string;
  ownerUserIdSnapshot: string | null;
  operationKind: EmailProviderMutationKind;
  operationKey: string;
  requestFingerprint: string;
  status: EmailProviderMutationAttemptStatus;
  attemptCount: number;
  providerResourceId: string | null;
  providerSecondaryResourceId: string | null;
  providerResult: Record<string, unknown>;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrepareEmailProviderMutationAttemptInput {
  connectionId: string;
  operationKind: EmailProviderMutationKind;
  operationKey: string;
  requestFingerprint: string;
  /** Canonical public.users.id resolved by the trusted route; null for cron. */
  actorUserId?: string | null;
}

export interface EmailProviderMutationAcceptance {
  attemptId: string;
  resourceId: string;
  secondaryResourceId: string | null;
  result: Record<string, unknown>;
}

export interface EmailProviderMutationAttemptStore {
  prepare(
    input: PrepareEmailProviderMutationAttemptInput
  ): Promise<EmailProviderMutationAttempt>;
  claim(attemptId: string): Promise<EmailProviderMutationAttempt | null>;
  persistAcceptance(input: {
    attemptId: string;
    providerResourceId: string;
    providerSecondaryResourceId: string | null;
    providerResult: Record<string, unknown>;
  }): Promise<EmailProviderMutationAttempt>;
  markProviderRejected(input: {
    attemptId: string;
    error: string;
  }): Promise<EmailProviderMutationAttempt>;
  markReconciliationRequired(input: {
    attemptId: string;
    providerResourceId: string | null;
    providerSecondaryResourceId: string | null;
    providerResult: Record<string, unknown>;
    error: string;
  }): Promise<EmailProviderMutationAttempt>;
  complete(attemptId: string): Promise<EmailProviderMutationAttempt>;
}

export interface ExecuteEmailProviderMutationInput extends PrepareEmailProviderMutationAttemptInput {
  /**
   * Proves this execution still owns the connection-wide mailbox lease. Every
   * caller must run the complete prepare -> provider -> reconciliation flow
   * inside that same lease. This is what makes a subsequently observed
   * `attempting` row stale rather than concurrently live.
   */
  assertMailboxLease(): Promise<void>;
  /** The only callback allowed to mint a new provider resource. */
  executeProvider(): Promise<{
    resourceId: string;
    secondaryResourceId?: string | null;
    result?: Record<string, unknown>;
  }>;
  /**
   * Idempotently binds the accepted provider identity to OPS. It may update
   * that exact provider resource, but must never create a second resource.
   */
  reconcile(acceptance: EmailProviderMutationAcceptance): Promise<void>;
  isDefinitiveProviderRejection?: (error: unknown) => boolean;
}

export class EmailProviderMutationReconciliationRequiredError extends Error {
  readonly code = "EMAIL_PROVIDER_MUTATION_RECONCILIATION_REQUIRED";

  constructor(
    message: string,
    readonly attemptId: string,
    readonly providerResourceId: string | null = null,
    readonly providerSecondaryResourceId: string | null = null
  ) {
    super(message);
    this.name = "EmailProviderMutationReconciliationRequiredError";
  }
}

export function isEmailProviderMutationReconciliationRequiredError(
  error: unknown
): error is EmailProviderMutationReconciliationRequiredError {
  return (
    error instanceof EmailProviderMutationReconciliationRequiredError ||
    (error instanceof Error &&
      "code" in error &&
      error.code === "EMAIL_PROVIDER_MUTATION_RECONCILIATION_REQUIRED")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapAttempt(
  row: Record<string, unknown>
): EmailProviderMutationAttempt {
  return {
    id: nonEmpty(row.id) ?? "",
    connectionId:
      nonEmpty(row.connection_id_snapshot) ?? nonEmpty(row.connection_id) ?? "",
    connectionTypeSnapshot: nonEmpty(row.connection_type_snapshot) as
      | "company"
      | "individual",
    providerSnapshot: nonEmpty(row.provider_snapshot) as
      | "gmail"
      | "microsoft365",
    mailboxAddressSnapshot: nonEmpty(row.mailbox_address_snapshot) ?? "",
    ownerUserIdSnapshot: nonEmpty(row.owner_user_id_snapshot),
    operationKind: nonEmpty(row.operation_kind) as EmailProviderMutationKind,
    operationKey: nonEmpty(row.operation_key) ?? "",
    requestFingerprint: nonEmpty(row.request_fingerprint) ?? "",
    status: nonEmpty(row.status) as EmailProviderMutationAttemptStatus,
    attemptCount: Number(row.attempt_count ?? 0),
    providerResourceId: nonEmpty(row.provider_resource_id),
    providerSecondaryResourceId: nonEmpty(row.provider_secondary_resource_id),
    providerResult: object(row.provider_result),
    lastError: nonEmpty(row.last_error),
    createdAt: nonEmpty(row.created_at) ?? "",
    updatedAt: nonEmpty(row.updated_at) ?? "",
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

/** Stable SHA-256 helper for binding a logical provider operation to scope. */
export function buildEmailProviderMutationFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export class SupabaseEmailProviderMutationAttemptStore implements EmailProviderMutationAttemptStore {
  constructor(private readonly supabase: SupabaseClient) {}

  private async requiredRpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<EmailProviderMutationAttempt> {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) throw new Error(error.message || `${name} failed`);
    const row = firstRow(data);
    if (!row || !nonEmpty(row.id)) {
      throw new Error(`${name} returned no provider mutation attempt`);
    }
    return mapAttempt(row);
  }

  private async nullableRpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<EmailProviderMutationAttempt | null> {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) throw new Error(error.message || `${name} failed`);
    const row = firstRow(data);
    return row && nonEmpty(row.id) ? mapAttempt(row) : null;
  }

  prepare(
    input: PrepareEmailProviderMutationAttemptInput
  ): Promise<EmailProviderMutationAttempt> {
    return this.requiredRpc("prepare_email_provider_mutation_attempt", {
      p_connection_id: input.connectionId,
      p_operation_kind: input.operationKind,
      p_operation_key: input.operationKey,
      p_request_fingerprint: input.requestFingerprint,
      p_actor_user_id: input.actorUserId ?? null,
    });
  }

  claim(attemptId: string): Promise<EmailProviderMutationAttempt | null> {
    return this.nullableRpc("claim_email_provider_mutation_attempt", {
      p_attempt_id: attemptId,
    });
  }

  persistAcceptance(input: {
    attemptId: string;
    providerResourceId: string;
    providerSecondaryResourceId: string | null;
    providerResult: Record<string, unknown>;
  }): Promise<EmailProviderMutationAttempt> {
    return this.requiredRpc("mark_email_provider_mutation_accepted", {
      p_attempt_id: input.attemptId,
      p_provider_resource_id: input.providerResourceId,
      p_provider_secondary_resource_id: input.providerSecondaryResourceId,
      p_provider_result: input.providerResult,
    });
  }

  markProviderRejected(input: {
    attemptId: string;
    error: string;
  }): Promise<EmailProviderMutationAttempt> {
    return this.requiredRpc("mark_email_provider_mutation_rejected", {
      p_attempt_id: input.attemptId,
      p_error: input.error,
    });
  }

  markReconciliationRequired(input: {
    attemptId: string;
    providerResourceId: string | null;
    providerSecondaryResourceId: string | null;
    providerResult: Record<string, unknown>;
    error: string;
  }): Promise<EmailProviderMutationAttempt> {
    return this.requiredRpc(
      "mark_email_provider_mutation_reconciliation_required",
      {
        p_attempt_id: input.attemptId,
        p_provider_resource_id: input.providerResourceId,
        p_provider_secondary_resource_id: input.providerSecondaryResourceId,
        p_provider_result: input.providerResult,
        p_error: input.error,
      }
    );
  }

  complete(attemptId: string): Promise<EmailProviderMutationAttempt> {
    return this.requiredRpc("complete_email_provider_mutation_attempt", {
      p_attempt_id: attemptId,
    });
  }
}

export function isDefinitiveEmailProviderRejection(error: unknown): boolean {
  if (
    error instanceof ProviderAuthError ||
    error instanceof ProviderScopeError
  ) {
    return true;
  }
  if (!(error instanceof ProviderApiError)) return false;
  // Do not infer safety from the entire 4xx range. Conflict/client-cancelled
  // responses can arrive after the provider committed a mutation, so unknown
  // 4xx statuses remain fenced unless a caller supplies a stricter,
  // provider-specific classifier.
  return DEFAULT_DEFINITIVE_PROVIDER_REJECTION_STATUSES.has(
    error.providerStatus
  );
}

function acceptanceFromAttempt(
  attempt: EmailProviderMutationAttempt
): EmailProviderMutationAcceptance | null {
  const resourceId = nonEmpty(attempt.providerResourceId);
  if (!resourceId) return null;
  return {
    attemptId: attempt.id,
    resourceId,
    secondaryResourceId: nonEmpty(attempt.providerSecondaryResourceId),
    result: attempt.providerResult,
  };
}

/**
 * Durable one-shot provider-create boundary. A new provider resource can only
 * be created after a database claim. Accepted retries run reconciliation only;
 * an unknown prior result is quarantined and never replayed blindly.
 */
export class EmailProviderMutationAttemptService {
  constructor(private readonly store: EmailProviderMutationAttemptStore) {}

  async execute(
    input: ExecuteEmailProviderMutationInput
  ): Promise<EmailProviderMutationAttempt> {
    await input.assertMailboxLease();
    let current = await this.store.prepare(input);
    let acceptance = acceptanceFromAttempt(current);

    if (current.status === "attempting") {
      // A second executor cannot reach this point while the original mailbox
      // lease is live. Re-check ownership immediately before the transition so
      // lease loss cannot clobber a concurrent attempt. The transition fires
      // the persistent, content-free recovery notification.
      await input.assertMailboxLease();
      await this.store.markReconciliationRequired({
        attemptId: current.id,
        providerResourceId: current.providerResourceId,
        providerSecondaryResourceId: current.providerSecondaryResourceId,
        providerResult: current.providerResult,
        error:
          current.lastError ||
          "A prior provider attempt ended without a durable acceptance result",
      });
      throw new EmailProviderMutationReconciliationRequiredError(
        current.lastError || "Provider acceptance requires reconciliation",
        current.id,
        current.providerResourceId,
        current.providerSecondaryResourceId
      );
    }

    if (current.status === "reconciliation_required" && !acceptance) {
      throw new EmailProviderMutationReconciliationRequiredError(
        current.lastError || "Provider acceptance requires reconciliation",
        current.id,
        current.providerResourceId,
        current.providerSecondaryResourceId
      );
    }

    if (!acceptance) {
      const claimed = await this.store.claim(current.id);
      if (!claimed) {
        throw new EmailProviderMutationReconciliationRequiredError(
          "Provider mutation is already in progress",
          current.id
        );
      }
      current = claimed;
      // Claiming is a database round-trip. Prove the same connection-wide
      // mailbox lease is still ours at the final safe boundary before the
      // one callback that is allowed to mint a provider resource.
      await input.assertMailboxLease();

      let providerOutput: Awaited<
        ReturnType<ExecuteEmailProviderMutationInput["executeProvider"]>
      >;
      try {
        providerOutput = await input.executeProvider();
      } catch (error) {
        const definitive =
          input.isDefinitiveProviderRejection?.(error) ??
          isDefinitiveEmailProviderRejection(error);
        if (definitive) {
          await this.store.markProviderRejected({
            attemptId: current.id,
            error: errorMessage(error),
          });
          throw error;
        }
        await this.quarantine(current.id, null, null, {}, errorMessage(error));
        throw new EmailProviderMutationReconciliationRequiredError(
          errorMessage(error),
          current.id
        );
      }

      const resourceId = nonEmpty(providerOutput.resourceId);
      const secondaryResourceId = nonEmpty(providerOutput.secondaryResourceId);
      const providerResult = object(providerOutput.result);
      if (!resourceId) {
        await this.quarantine(
          current.id,
          null,
          secondaryResourceId,
          providerResult,
          "Provider returned no durable resource identity"
        );
        throw new EmailProviderMutationReconciliationRequiredError(
          "Provider returned no durable resource identity",
          current.id,
          null,
          secondaryResourceId
        );
      }

      let accepted: EmailProviderMutationAttempt | null = null;
      let acceptanceError: unknown = null;
      for (let attempt = 0; attempt < 2 && !accepted; attempt += 1) {
        try {
          accepted = await this.store.persistAcceptance({
            attemptId: current.id,
            providerResourceId: resourceId,
            providerSecondaryResourceId: secondaryResourceId,
            providerResult,
          });
        } catch (error) {
          acceptanceError = error;
        }
      }
      if (!accepted) {
        await this.quarantine(
          current.id,
          resourceId,
          secondaryResourceId,
          providerResult,
          `Provider accepted but acceptance persistence failed: ${errorMessage(
            acceptanceError
          )}`
        );
        throw new EmailProviderMutationReconciliationRequiredError(
          errorMessage(acceptanceError),
          current.id,
          resourceId,
          secondaryResourceId
        );
      }
      current = accepted;
      acceptance = {
        attemptId: current.id,
        resourceId,
        secondaryResourceId,
        result: providerResult,
      };
    }

    let reconciliationError: unknown = null;
    let reconciled = false;
    for (let attempt = 0; attempt < 2 && !reconciled; attempt += 1) {
      try {
        await input.reconcile(acceptance);
        reconciled = true;
      } catch (error) {
        reconciliationError = error;
      }
    }
    if (!reconciled) {
      await this.quarantine(
        current.id,
        acceptance.resourceId,
        acceptance.secondaryResourceId,
        acceptance.result,
        errorMessage(reconciliationError)
      );
      throw new EmailProviderMutationReconciliationRequiredError(
        errorMessage(reconciliationError),
        current.id,
        acceptance.resourceId,
        acceptance.secondaryResourceId
      );
    }

    let completionError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.store.complete(current.id);
      } catch (error) {
        completionError = error;
      }
    }
    const completionMessage = `Provider mutation reconciled but completion persistence failed: ${errorMessage(
      completionError
    )}`;
    await this.quarantine(
      current.id,
      acceptance.resourceId,
      acceptance.secondaryResourceId,
      acceptance.result,
      completionMessage
    );
    throw new EmailProviderMutationReconciliationRequiredError(
      completionMessage,
      current.id,
      acceptance.resourceId,
      acceptance.secondaryResourceId
    );
  }

  private async quarantine(
    attemptId: string,
    providerResourceId: string | null,
    providerSecondaryResourceId: string | null,
    providerResult: Record<string, unknown>,
    error: string
  ): Promise<void> {
    try {
      await this.store.markReconciliationRequired({
        attemptId,
        providerResourceId,
        providerSecondaryResourceId,
        providerResult,
        error,
      });
    } catch {
      // The durable `attempting` claim itself remains a no-replay fence even if
      // this richer recovery marker cannot be persisted during an outage.
    }
  }
}

export function createEmailProviderMutationAttemptService(
  supabase: SupabaseClient
): EmailProviderMutationAttemptService {
  return new EmailProviderMutationAttemptService(
    new SupabaseEmailProviderMutationAttemptStore(supabase)
  );
}
