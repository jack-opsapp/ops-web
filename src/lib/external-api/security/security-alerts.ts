import "server-only";

import {
  readIdempotencyHmacKeyRing,
  type VersionedHmacKeyRing,
} from "@/lib/external-api/intake/idempotency";

const DEFAULT_MAINTENANCE_LIMIT = 100;
const MAXIMUM_MAINTENANCE_LIMIT = 500;

type RpcReply = PromiseLike<{
  data: unknown;
  error: unknown;
}>;

export interface ExternalApiOperationsClient {
  rpc(
    name: "maintain_external_api_operations_as_system",
    args: {
      p_idempotency_kids: number[];
      p_limit: number;
      p_now: string;
    }
  ): RpcReply;
}

export type ExternalApiAuthorizationDenialCode =
  | "insufficient_scope"
  | "source_not_allowed"
  | "form_not_allowed"
  | "cross_tenant_denied";

export interface ExternalApiAuthorizationDenialClient {
  rpc(
    name: "record_external_api_authorization_denial_as_system",
    args: {
      p_principal_id: string;
      p_credential_id: string;
      p_company_id: string;
      p_failure_code: ExternalApiAuthorizationDenialCode;
    }
  ): RpcReply;
}

export interface ExternalApiOperationsHealth {
  activeExpiredUploadBatches: number;
  overlapCredentialsDue: number;
  expiredNetworkFingerprints: number;
  expiredSecurityEvents: number;
  expiredProjectionVersions: number;
  pendingSecurityAlerts: number;
}

export interface ExternalApiOperationsResult {
  credentialsRetired: number;
  networkFingerprintsPurged: number;
  securityEventsPurged: number;
  projectionVersionsPruned: number;
  alertsCreated: number;
  recipientsNotified: number;
  referencedIdempotencyKids: number[];
  health: ExternalApiOperationsHealth;
}

export interface ExternalApiOperationsOptions {
  idempotencyKeyRing?: VersionedHmacKeyRing;
  limit?: number;
  now?: Date;
}

export class ExternalApiOperationsUnavailableError extends Error {
  constructor() {
    super("External API operations are unavailable");
    this.name = "ExternalApiOperationsUnavailableError";
  }
}

export async function recordExternalApiAuthorizationDenial(
  client: ExternalApiAuthorizationDenialClient,
  actor: Readonly<{
    principalId: string;
    credentialId: string;
    companyId: string;
  }>,
  code: ExternalApiAuthorizationDenialCode
): Promise<void> {
  try {
    const reply = await client.rpc(
      "record_external_api_authorization_denial_as_system",
      {
        p_principal_id: actor.principalId,
        p_credential_id: actor.credentialId,
        p_company_id: actor.companyId,
        p_failure_code: code,
      }
    );
    if (reply.error || reply.data !== true) {
      throw new ExternalApiOperationsUnavailableError();
    }
  } catch {
    throw new ExternalApiOperationsUnavailableError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedCount(
  record: Record<string, unknown>,
  key: string
): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_000_000
  ) {
    throw new ExternalApiOperationsUnavailableError();
  }
  return value;
}

function readKids(record: Record<string, unknown>, key: string): number[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some(
      (kid) =>
        typeof kid !== "number" ||
        !Number.isSafeInteger(kid) ||
        kid < 1 ||
        kid > 32_767
    )
  ) {
    throw new ExternalApiOperationsUnavailableError();
  }
  return [...new Set(value)].sort((left, right) => left - right);
}

function resolveLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_MAINTENANCE_LIMIT;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAXIMUM_MAINTENANCE_LIMIT
  ) {
    throw new ExternalApiOperationsUnavailableError();
  }
  return value;
}

function resolveNow(now: Date | undefined): Date {
  const value = now ?? new Date();
  if (!Number.isFinite(value.getTime())) {
    throw new ExternalApiOperationsUnavailableError();
  }
  return value;
}

export async function runExternalApiOperationsMaintenance(
  client: ExternalApiOperationsClient,
  options: ExternalApiOperationsOptions = {}
): Promise<ExternalApiOperationsResult> {
  let keyRing: VersionedHmacKeyRing;
  try {
    keyRing = options.idempotencyKeyRing ?? readIdempotencyHmacKeyRing();
  } catch {
    throw new ExternalApiOperationsUnavailableError();
  }

  const idempotencyKids = [...keyRing.keys.keys()].sort(
    (left, right) => left - right
  );
  if (
    idempotencyKids.length < 1 ||
    idempotencyKids.length > 32 ||
    !idempotencyKids.includes(keyRing.activeKid)
  ) {
    throw new ExternalApiOperationsUnavailableError();
  }

  let reply: Awaited<RpcReply>;
  try {
    reply = await client.rpc("maintain_external_api_operations_as_system", {
      p_idempotency_kids: idempotencyKids,
      p_limit: resolveLimit(options.limit),
      p_now: resolveNow(options.now).toISOString(),
    });
  } catch {
    throw new ExternalApiOperationsUnavailableError();
  }

  if (reply.error || !isRecord(reply.data)) {
    throw new ExternalApiOperationsUnavailableError();
  }

  const missingKids = readKids(reply.data, "missing_idempotency_kids");
  const referencedKids = readKids(reply.data, "referenced_idempotency_kids");
  if (
    missingKids.length > 0 ||
    referencedKids.some((kid) => !idempotencyKids.includes(kid))
  ) {
    throw new ExternalApiOperationsUnavailableError();
  }

  const health = reply.data.health;
  if (!isRecord(health)) {
    throw new ExternalApiOperationsUnavailableError();
  }

  return {
    credentialsRetired: readBoundedCount(reply.data, "credentials_retired"),
    networkFingerprintsPurged: readBoundedCount(
      reply.data,
      "network_fingerprints_purged"
    ),
    securityEventsPurged: readBoundedCount(
      reply.data,
      "security_events_purged"
    ),
    projectionVersionsPruned: readBoundedCount(
      reply.data,
      "projection_versions_pruned"
    ),
    alertsCreated: readBoundedCount(reply.data, "alerts_created"),
    recipientsNotified: readBoundedCount(reply.data, "recipients_notified"),
    referencedIdempotencyKids: referencedKids,
    health: {
      activeExpiredUploadBatches: readBoundedCount(
        health,
        "active_expired_upload_batches"
      ),
      overlapCredentialsDue: readBoundedCount(
        health,
        "overlap_credentials_due"
      ),
      expiredNetworkFingerprints: readBoundedCount(
        health,
        "expired_network_fingerprints"
      ),
      expiredSecurityEvents: readBoundedCount(
        health,
        "expired_security_events"
      ),
      expiredProjectionVersions: readBoundedCount(
        health,
        "expired_projection_versions"
      ),
      pendingSecurityAlerts: readBoundedCount(
        health,
        "pending_security_alerts"
      ),
    },
  };
}
