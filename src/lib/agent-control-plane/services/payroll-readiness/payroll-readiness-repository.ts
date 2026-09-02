import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  PAYROLL_READINESS_MAX_PAYER_HISTORY,
  PAYROLL_READINESS_MAX_RECEIVABLES,
  PAYROLL_READINESS_MAX_RECURRING_OBLIGATIONS,
  PAYROLL_READINESS_MAX_REIMBURSEMENT_BATCHES,
  PAYROLL_READINESS_MAX_SOURCE_SNAPSHOT_CHARACTERS,
  PAYROLL_READINESS_SCHEMA_REVISION,
  PayrollReadinessSourceSnapshotSchema,
  PayrollReadinessTargetDateError,
  type PayrollReadinessSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/payroll-readiness";
import {
  PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  MCP_EXPOSURE_V8,
  MCP_EXPOSURE_V9,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface PayrollReadinessRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface PayrollReadinessRpcRequest extends PromiseLike<PayrollReadinessRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<PayrollReadinessRpcResult>;
}

export interface PayrollReadinessRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PayrollReadinessRpcRequest;
}

export class PayrollReadinessRepositoryUnavailableError extends Error {
  constructor() {
    super("Payroll readiness source is unavailable");
    this.name = "PayrollReadinessRepositoryUnavailableError";
  }
}

function isTargetDateRpcError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "22023" &&
    typeof candidate.message === "string" &&
    candidate.message.includes("AGENT_PAYROLL_READINESS_TARGET_DATE_INVALID")
  );
}

function binding(actorContext: ActorContext) {
  if (actorContext.auth.channel !== "mcp") {
    throw new TypeError("Payroll readiness requires a supported MCP actor");
  }
  const exposureRevision =
    actorContext.capabilityManifestRevision ===
    PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION
      ? MCP_EXPOSURE_V8.revision
      : actorContext.capabilityManifestRevision ===
          RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION
        ? MCP_EXPOSURE_V9.revision
        : null;
  if (exposureRevision === null) {
    throw new TypeError("Payroll readiness requires a supported MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_capability_manifest_revision: actorContext.capabilityManifestRevision,
    p_exposure_revision: exposureRevision,
    p_capability_id: "check_payroll_readiness",
    p_capability_revision: `check_payroll_readiness:${PAYROLL_READINESS_SCHEMA_REVISION}`,
  } as const;
}

function companyLocalDate(observedAt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(observedAt));
  const part = (type: "year" | "month" | "day") =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function timestampNanoseconds(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
    value
  );
  if (!match) return null;
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(milliseconds)) return null;
  return (
    BigInt(milliseconds) * BigInt(1_000_000) +
    BigInt((match[2] ?? "").padEnd(9, "0"))
  );
}

export interface PayrollReadinessRepository {
  readSourceSnapshot(input: {
    actorContext: ActorContext;
    observedAt: string;
    targetDate: string;
    signal?: AbortSignal;
  }): Promise<PayrollReadinessSourceSnapshot>;
}

export function createPayrollReadinessRepository(input: {
  rpc: PayrollReadinessRpcClient["rpc"];
}): PayrollReadinessRepository {
  if (!input || typeof input.rpc !== "function") {
    throw new TypeError("A payroll readiness RPC client is required");
  }
  const repository: PayrollReadinessRepository = {
    async readSourceSnapshot(readInput) {
      const request = input.rpc("read_agent_payroll_readiness_as_system", {
        ...binding(readInput.actorContext),
        p_observed_at: readInput.observedAt,
        p_target_date: readInput.targetDate,
        p_recurring_obligation_limit:
          PAYROLL_READINESS_MAX_RECURRING_OBLIGATIONS,
        p_reimbursement_batch_limit:
          PAYROLL_READINESS_MAX_REIMBURSEMENT_BATCHES,
        p_receivable_limit: PAYROLL_READINESS_MAX_RECEIVABLES,
        p_payer_history_limit: PAYROLL_READINESS_MAX_PAYER_HISTORY,
      });
      const response =
        readInput.signal && request.abortSignal
          ? await request.abortSignal(readInput.signal)
          : await request;
      if (response.error) {
        if (isTargetDateRpcError(response.error)) {
          throw new PayrollReadinessTargetDateError();
        }
        throw new PayrollReadinessRepositoryUnavailableError();
      }
      let serializedSource: string | undefined;
      try {
        serializedSource = JSON.stringify(response.data);
      } catch {
        throw new PayrollReadinessRepositoryUnavailableError();
      }
      if (
        serializedSource === undefined ||
        serializedSource.length >
          PAYROLL_READINESS_MAX_SOURCE_SNAPSHOT_CHARACTERS
      ) {
        throw new PayrollReadinessRepositoryUnavailableError();
      }
      const parsed = PayrollReadinessSourceSnapshotSchema.safeParse(
        response.data
      );
      const requestedInstant = timestampNanoseconds(readInput.observedAt);
      if (
        !parsed.success ||
        requestedInstant === null ||
        timestampNanoseconds(parsed.data.observed_at) !== requestedInstant ||
        parsed.data.target_date !== readInput.targetDate ||
        parsed.data.context.company_id !== readInput.actorContext.companyId ||
        parsed.data.business_date !==
          companyLocalDate(readInput.observedAt, parsed.data.context.timezone)
      ) {
        throw new PayrollReadinessRepositoryUnavailableError();
      }
      return parsed.data;
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedPayrollReadinessRepository(
  value: unknown
): value is PayrollReadinessRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
