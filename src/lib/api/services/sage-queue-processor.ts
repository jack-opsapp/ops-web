import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountingSyncQueueRow,
  AccountingSyncQueueStatus,
} from "./accounting-sync-queue-types";
import { AccountingSyncAuditService } from "./accounting-sync-audit-service";
import { AccountingSyncQueueService } from "./accounting-sync-queue-service";
import { AccountingTokenService } from "./accounting-token-service";
import {
  createSageWriteClient,
  type SageAcceptedWrite,
  SageApiError,
  type SageApiClientOptions,
  type SageWriteClient,
} from "./sage-api-client";
import {
  assertSageWriteAllowed,
  type SageProviderEnvironment,
  type SageWriteBoundary,
} from "./sage-config";
import {
  sageIdempotencyKey,
  type SageIdempotentResource,
} from "./sage-idempotency";
import { SageQueueRepository } from "./sage-queue-repository";
import { decryptToken } from "./token-cipher";

const IDEMPOTENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export interface SageQueueConnection {
  id: string;
  companyId: string;
  provider: string;
  providerEnvironment: SageProviderEnvironment;
  isConnected: boolean;
  syncEnabled: boolean;
  syncDirection: string;
  encryptedBusinessId: string | null;
}

export interface PreparedSageQueueWrite {
  resource: SageIdempotentResource;
  payload: Record<string, unknown>;
  externalId: string | null;
  finalize: (externalId: string) => Promise<void>;
}

export interface SageQueueResult {
  queueId: string;
  entityType: AccountingSyncQueueRow["entityType"];
  entityId: string;
  status: "succeeded" | "retry" | "blocked" | "needs_review";
  externalId?: string | null;
  error?: string;
}

interface SageQueuePort {
  recordProviderAcceptance: AccountingSyncQueueService["recordProviderAcceptance"];
  markSucceeded: AccountingSyncQueueService["markSucceeded"];
  scheduleRetry: AccountingSyncQueueService["scheduleRetry"];
  markBlocked: AccountingSyncQueueService["markBlocked"];
  markNeedsReview: AccountingSyncQueueService["markNeedsReview"];
}

export interface SageQueueProcessorDependencies {
  loadConnection: (
    row: AccountingSyncQueueRow
  ) => Promise<SageQueueConnection | null>;
  decryptBusinessId: (encrypted: string) => string | null;
  assertWriteAllowed: (input: SageWriteBoundary) => SageWriteBoundary | void;
  getValidToken: (connectionId: string) => Promise<{
    accessToken: string;
    providerEnvironment: SageProviderEnvironment;
  }>;
  refreshAccessToken: (connectionId: string) => Promise<string>;
  disconnect: (connection: SageQueueConnection) => Promise<void>;
  prepare: (
    row: AccountingSyncQueueRow,
    connection: SageQueueConnection
  ) => Promise<PreparedSageQueueWrite>;
  createClient: (options: SageApiClientOptions) => SageWriteClient;
  queue: SageQueuePort;
  recordAudit: (input: {
    row: AccountingSyncQueueRow;
    status: Exclude<
      AccountingSyncQueueStatus,
      "pending" | "claimed" | "cancelled"
    >;
    externalId?: string | null;
    error?: string;
  }) => Promise<void>;
  now?: () => Date;
}

class SageQueueDecisionError extends Error {
  constructor(
    readonly kind: "blocked" | "needs_review",
    message: string
  ) {
    super(message);
    this.name = "SageQueueDecisionError";
  }
}

export class AcceptedWriteDurabilityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AcceptedWriteDurabilityError";
  }
}

function text(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Sage queue processing failed.";
}

function needsReview(message: string): never {
  throw new SageQueueDecisionError("needs_review", message);
}

function assertClaimOwnership(
  row: AccountingSyncQueueRow,
  workerId: string
): void {
  if (row.provider !== "sage") {
    throw new Error("Sage processor received a non-Sage queue row.");
  }
  if (row.status !== "claimed") {
    throw new Error("Sage processor requires a claimed queue row.");
  }
  if (!workerId.trim() || row.lockedBy !== workerId) {
    throw new Error("Sage processor does not own this queue claim.");
  }
  if (row.providerAcceptedAt) {
    throw new AcceptedWriteDurabilityError(
      "Sage queue row is already provider-accepted and requires finalization review."
    );
  }
}

function payloadEnvironment(
  row: AccountingSyncQueueRow
): SageProviderEnvironment {
  const value = row.payloadSnapshot.providerEnvironment;
  if (value !== "sandbox" && value !== "production") {
    needsReview("Sage queue environment is missing or invalid.");
  }
  return value;
}

function assertOperation(row: AccountingSyncQueueRow): void {
  if (["link", "reconcile"].includes(row.operation)) {
    needsReview(`Sage outbound ${row.operation} requires operator review.`);
  }
  if (
    row.operation === "inactivate" &&
    !["customer", "supplier"].includes(row.entityType)
  ) {
    needsReview(`Sage ${row.entityType} cannot be inactivated.`);
  }
  if (
    row.operation === "void" &&
    !["invoice", "payment", "supplier_bill", "supplier_bill_payment"].includes(
      row.entityType
    )
  ) {
    needsReview(`Sage ${row.entityType} cannot be voided.`);
  }
  if (row.operation === "delete" && row.entityType !== "estimate") {
    needsReview(`Sage ${row.entityType} cannot be deleted.`);
  }
  if (row.operation === "delete_soft") {
    needsReview("Sage delete_soft must be normalized before provider access.");
  }
}

function assertReplayWindow(row: AccountingSyncQueueRow, now: Date): void {
  if (row.attempts <= 1) return;
  const createdAt = Date.parse(row.createdAt);
  if (
    !Number.isFinite(createdAt) ||
    now.getTime() - createdAt >= IDEMPOTENCY_WINDOW_MS
  ) {
    needsReview(
      "Sage retry is outside the seven-day idempotency window and requires review."
    );
  }
}

function readExternalId(
  response: SageAcceptedWrite,
  fallback: string | null
): string {
  const direct = response.data;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const record = direct as Record<string, unknown>;
    if (typeof record.id === "string" && record.id.trim()) {
      return record.id.trim();
    }
    for (const value of Object.values(record)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const nestedId = (value as Record<string, unknown>).id;
      if (typeof nestedId === "string" && nestedId.trim()) {
        return nestedId.trim();
      }
    }
  }
  if (fallback?.trim()) return fallback.trim();
  needsReview("Sage accepted the write without returning an entity id.");
}

function isProviderDelete(row: AccountingSyncQueueRow): boolean {
  return row.operation === "void" || row.operation === "delete";
}

function classification(error: unknown): {
  kind: "retry" | "blocked" | "needs_review";
  message: string;
} {
  if (error instanceof SageQueueDecisionError) {
    return { kind: error.kind, message: error.message };
  }
  if (error instanceof SageApiError) {
    if (error.retryable) return { kind: "retry", message: error.message };
    return { kind: "needs_review", message: error.message };
  }
  const message = text(error);
  if (/mapping|required|missing|unavailable|invalid|not found/i.test(message)) {
    return { kind: "blocked", message };
  }
  return { kind: "retry", message };
}

async function auditBestEffort(
  dependencies: SageQueueProcessorDependencies,
  input: Parameters<SageQueueProcessorDependencies["recordAudit"]>[0]
): Promise<void> {
  try {
    await dependencies.recordAudit(input);
  } catch {
    // Queue state is the durable source of truth; audit failure cannot change
    // the provider write decision.
  }
}

async function terminalFailure(
  dependencies: SageQueueProcessorDependencies,
  row: AccountingSyncQueueRow,
  workerId: string,
  error: unknown
): Promise<SageQueueResult> {
  const classified = classification(error);
  if (classified.kind === "retry") {
    const retried = await dependencies.queue.scheduleRetry(
      row,
      classified.message,
      { workerId }
    );
    await auditBestEffort(dependencies, {
      row,
      status: retried ? "failed" : "blocked",
      error: classified.message,
    });
    return {
      queueId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status: retried ? "retry" : "blocked",
      error: classified.message,
    };
  }

  if (classified.kind === "blocked") {
    await dependencies.queue.markBlocked(row.id, classified.message, {
      workerId,
    });
  } else {
    await dependencies.queue.markNeedsReview(row.id, classified.message, {
      workerId,
    });
  }
  await auditBestEffort(dependencies, {
    row,
    status: classified.kind,
    error: classified.message,
  });
  return {
    queueId: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    status: classified.kind,
    error: classified.message,
  };
}

export async function processSageQueueRow(input: {
  row: AccountingSyncQueueRow;
  workerId: string;
  dependencies: SageQueueProcessorDependencies;
}): Promise<SageQueueResult> {
  const { row, workerId, dependencies } = input;
  assertClaimOwnership(row, workerId);
  const now = dependencies.now?.() ?? new Date();

  try {
    assertOperation(row);
    assertReplayWindow(row, now);

    const connection = await dependencies.loadConnection(row);
    if (
      !connection ||
      connection.id !== row.connectionId ||
      connection.companyId !== row.companyId ||
      connection.provider !== "sage"
    ) {
      needsReview("Exact Sage connection is unavailable.");
    }
    if (
      !connection.isConnected ||
      !connection.syncEnabled ||
      !["push_only", "bidirectional"].includes(connection.syncDirection)
    ) {
      needsReview("Sage connection is not enabled for outbound writes.");
    }

    const queueEnvironment = payloadEnvironment(row);
    if (connection.providerEnvironment !== queueEnvironment) {
      needsReview("Sage queue and connection environments do not match.");
    }
    if (!connection.encryptedBusinessId) {
      needsReview("Sage business identity is unavailable.");
    }
    const businessId = dependencies.decryptBusinessId(
      connection.encryptedBusinessId
    );
    if (!businessId?.trim()) {
      needsReview("Sage business identity could not be decrypted.");
    }
    dependencies.assertWriteAllowed({
      environment: connection.providerEnvironment,
      businessId,
    });

    const token = await dependencies.getValidToken(connection.id);
    if (!token.accessToken.trim())
      needsReview("Sage access token is unavailable.");
    if (token.providerEnvironment !== connection.providerEnvironment) {
      needsReview("Sage token and connection environments do not match.");
    }

    let accessToken = token.accessToken;
    const client = dependencies.createClient({
      businessId,
      getAccessToken: async () => accessToken,
      refreshAccessToken: async () => {
        accessToken = await dependencies.refreshAccessToken(connection.id);
        return accessToken;
      },
      onDisconnect: async () => dependencies.disconnect(connection),
    });
    const prepared = await dependencies.prepare(row, connection);
    const idempotency = sageIdempotencyKey(row.id, prepared.resource);

    let accepted: SageAcceptedWrite;
    if (isProviderDelete(row)) {
      if (!prepared.externalId) {
        needsReview(
          `Sage ${row.entityType} ${row.operation} requires an existing provider id.`
        );
      }
      accepted = await client.voidOrDelete(
        prepared.resource,
        prepared.externalId
      );
    } else if (prepared.externalId) {
      accepted = await client.update(
        prepared.resource,
        prepared.externalId,
        prepared.payload,
        idempotency
      );
    } else if (row.operation === "create") {
      accepted = await client.create(
        prepared.resource,
        prepared.payload,
        idempotency
      );
    } else {
      needsReview(
        `Sage ${row.entityType} ${row.operation} requires an existing provider id.`
      );
    }

    const externalId = readExternalId(accepted, prepared.externalId);
    const acceptedAt = accepted.evidence.acceptedAt;
    const acceptedTimestamp = Date.parse(acceptedAt);
    if (!Number.isFinite(acceptedTimestamp)) {
      throw new AcceptedWriteDurabilityError(
        "Sage accepted-write evidence has an invalid timestamp."
      );
    }

    try {
      await dependencies.queue.recordProviderAcceptance({
        id: row.id,
        workerId,
        providerRequestId: accepted.evidence.requestId ?? null,
        acceptedAt,
        idempotencyExpiresAt: new Date(
          acceptedTimestamp + IDEMPOTENCY_WINDOW_MS
        ).toISOString(),
      });
    } catch (cause) {
      throw new AcceptedWriteDurabilityError(
        "Sage write was accepted but acceptance evidence could not be persisted.",
        { cause }
      );
    }

    try {
      await prepared.finalize(externalId);
      await dependencies.queue.markSucceeded(row.id, {
        externalId,
        workerId,
      });
    } catch (cause) {
      const message = `Sage write succeeded but OPS finalization failed: ${text(cause)}`;
      try {
        await dependencies.queue.markNeedsReview(row.id, message, {
          workerId,
          externalId,
        });
      } catch (terminalCause) {
        throw new AcceptedWriteDurabilityError(
          "Sage write was accepted but terminal queue finalization failed.",
          { cause: terminalCause }
        );
      }
      await auditBestEffort(dependencies, {
        row,
        status: "needs_review",
        externalId,
        error: message,
      });
      return {
        queueId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        status: "needs_review",
        externalId,
        error: message,
      };
    }

    await auditBestEffort(dependencies, {
      row,
      status: "succeeded",
      externalId,
    });
    return {
      queueId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status: "succeeded",
      externalId,
    };
  } catch (error) {
    if (error instanceof AcceptedWriteDurabilityError) throw error;
    return terminalFailure(dependencies, row, workerId, error);
  }
}

export function createSageQueueProcessorDependencies(
  supabase: SupabaseClient
): SageQueueProcessorDependencies {
  const repository = new SageQueueRepository(supabase);
  const queue = new AccountingSyncQueueService(supabase);
  const audit = new AccountingSyncAuditService(supabase);
  return {
    loadConnection: (row) => repository.loadConnection(row),
    decryptBusinessId: decryptToken,
    assertWriteAllowed: assertSageWriteAllowed,
    getValidToken: async (connectionId) => {
      const token = await AccountingTokenService.getValidToken(
        supabase,
        connectionId
      );
      return {
        accessToken: token.accessToken,
        providerEnvironment: token.providerEnvironment,
      };
    },
    refreshAccessToken: (connectionId) =>
      AccountingTokenService.forceRefresh(supabase, connectionId),
    disconnect: async (connection) => {
      await AccountingTokenService.disconnectGrant(
        supabase,
        connection.id,
        "sage"
      );
    },
    prepare: (row, connection) => repository.prepare(row, connection),
    createClient: createSageWriteClient,
    queue,
    recordAudit: async (input) => {
      const status = input.status;
      await audit.record({
        queueId: input.row.id,
        companyId: input.row.companyId,
        connectionId: input.row.connectionId,
        provider: "sage",
        direction: "ops_to_sage",
        entityType: input.row.entityType,
        entityId: input.row.entityId,
        externalId: input.externalId ?? input.row.externalId,
        operation: input.row.operation,
        status,
        source: "worker",
        decision:
          status === "succeeded"
            ? "ops_won"
            : status === "failed"
              ? "retry"
              : status,
        opsUpdatedAt: input.row.sourceUpdatedAt,
        beforeSnapshot: input.row.payloadSnapshot,
        afterSnapshot: input.externalId ? { externalId: input.externalId } : {},
        error: input.error,
      });
    },
  };
}
