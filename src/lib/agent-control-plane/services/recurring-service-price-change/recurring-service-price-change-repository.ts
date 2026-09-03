import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_REVISION,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_ACCOUNTS,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_SNAPSHOT_CHARACTERS,
  RecurringServicePriceChangeDetailReadSchema,
  RecurringServicePriceChangeRecurrenceCatalogSchema,
  type PrepareRecurringServicePriceChangeInput,
  type RecurringServicePriceChangeDetailRead,
  type RecurringServicePriceChangeRecurrenceCatalog,
} from "@/lib/agent-control-plane/contracts/recurring-service-price-change";
import {
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  MCP_EXPOSURE_V10,
  MCP_EXPOSURE_V9,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface RpcRequest extends PromiseLike<RpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>;
}

export interface RecurringServicePriceChangeRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

export class RecurringServicePriceChangeRepositoryUnavailableError extends Error {
  constructor() {
    super("Recurring-service price source is unavailable");
    this.name = "RecurringServicePriceChangeRepositoryUnavailableError";
  }
}

export class RecurringServicePriceChangeRepositoryAuthorityError extends Error {
  constructor() {
    super("Recurring-service price authority changed");
    this.name = "RecurringServicePriceChangeRepositoryAuthorityError";
  }
}

export class RecurringServicePriceChangeRepositoryInputError extends Error {
  constructor() {
    super("Recurring-service price input is outside the supported window");
    this.name = "RecurringServicePriceChangeRepositoryInputError";
  }
}

export class RecurringServicePriceChangeRepositoryStaleError extends Error {
  constructor() {
    super("Recurring-service price source changed");
    this.name = "RecurringServicePriceChangeRepositoryStaleError";
  }
}

export class RecurringServicePriceChangeRepositoryBoundError extends Error {
  constructor() {
    super("Recurring-service price source exceeds its safe bound");
    this.name = "RecurringServicePriceChangeRepositoryBoundError";
  }
}

function isInputRpcError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Readonly<Record<string, unknown>>;
  return (
    value.code === "22023" &&
    typeof value.message === "string" &&
    (value.message.startsWith(
      "AGENT_RECURRING_SERVICE_PRICE_CHANGE_MONTH_INVALID"
    ) ||
      value.message.startsWith(
        "AGENT_RECURRING_SERVICE_PRICE_CHANGE_INPUT_INVALID"
      ))
  );
}

function isAuthorityDenial(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Readonly<Record<string, unknown>>;
  const code = typeof value.code === "string" ? value.code : "";
  const message = typeof value.message === "string" ? value.message : "";
  return (
    code === "42501" ||
    message.startsWith("AGENT_RECURRING_SERVICE_PRICE_CHANGE_AUTHORITY") ||
    message.startsWith("AGENT_RECURRING_SERVICE_PRICE_CHANGE_GRANT") ||
    message.startsWith("AGENT_RECURRING_SERVICE_PRICE_CHANGE_BINDING")
  );
}

function isStaleSource(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Readonly<Record<string, unknown>>;
  return (
    value.code === "55000" &&
    typeof value.message === "string" &&
    value.message.startsWith(
      "AGENT_RECURRING_SERVICE_PRICE_CHANGE_SELECTION_STALE"
    )
  );
}

function isSourceBound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Readonly<Record<string, unknown>>;
  return (
    value.code === "54000" &&
    typeof value.message === "string" &&
    value.message.startsWith(
      "AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_BOUND"
    )
  );
}

function binding(actorContext: ActorContext) {
  if (actorContext.auth.channel !== "mcp") {
    throw new TypeError(
      "Recurring-service price preview requires a supported MCP actor"
    );
  }
  const exposureRevision =
    actorContext.capabilityManifestRevision ===
    RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION
      ? MCP_EXPOSURE_V9.revision
      : actorContext.capabilityManifestRevision ===
          ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION
        ? MCP_EXPOSURE_V10.revision
        : null;
  if (exposureRevision === null) {
    throw new TypeError(
      "Recurring-service price preview requires a supported MCP actor"
    );
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
    p_capability_id: "prepare_recurring_service_price_change",
    p_capability_revision: RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_REVISION,
  } as const;
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

export interface RecurringServicePriceChangeRepository {
  readRecurrenceCatalog(input: {
    actorContext: ActorContext;
    observedAt: string;
    input: PrepareRecurringServicePriceChangeInput;
    signal?: AbortSignal;
  }): Promise<RecurringServicePriceChangeRecurrenceCatalog>;
  readSourceSnapshot(input: {
    actorContext: ActorContext;
    observedAt: string;
    input: PrepareRecurringServicePriceChangeInput;
    selectedRecurrenceIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<RecurringServicePriceChangeDetailRead>;
  assertCurrentAuthority(input: {
    actorContext: ActorContext;
    signal?: AbortSignal;
  }): Promise<void>;
}

export function createRecurringServicePriceChangeRepository(input: {
  rpc: RecurringServicePriceChangeRpcClient["rpc"];
}): RecurringServicePriceChangeRepository {
  if (!input || typeof input.rpc !== "function") {
    throw new TypeError("A recurring-service price RPC client is required");
  }
  async function executeRead(readInput: {
    actorContext: ActorContext;
    observedAt: string;
    input: PrepareRecurringServicePriceChangeInput;
    phase: "catalog" | "detail";
    selectedRecurrenceIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<unknown> {
    const request = input.rpc(
      "read_agent_recurring_service_price_change_as_system",
      {
        ...binding(readInput.actorContext),
        p_observed_at: readInput.observedAt,
        p_service_selector: readInput.input.service_selector,
        p_increase_percent: readInput.input.increase_percent,
        p_effective_month: readInput.input.effective_month,
        p_account_limit: RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_ACCOUNTS,
        p_read_phase: readInput.phase,
        p_selected_recurrence_ids: [...readInput.selectedRecurrenceIds],
      }
    );
    const response =
      readInput.signal && request.abortSignal
        ? await request.abortSignal(readInput.signal)
        : await request;
    if (response.error) {
      if (isAuthorityDenial(response.error)) {
        throw new RecurringServicePriceChangeRepositoryAuthorityError();
      }
      if (isInputRpcError(response.error)) {
        throw new RecurringServicePriceChangeRepositoryInputError();
      }
      if (isStaleSource(response.error)) {
        throw new RecurringServicePriceChangeRepositoryStaleError();
      }
      if (isSourceBound(response.error)) {
        throw new RecurringServicePriceChangeRepositoryBoundError();
      }
      throw new RecurringServicePriceChangeRepositoryUnavailableError();
    }
    return response.data;
  }

  function matchesReadIdentity(
    value: {
      observed_at: string;
      context: { company_id: string };
      request: {
        service_selector: string;
        increase_percent: string;
        effective_month: string;
      };
    },
    readInput: {
      actorContext: ActorContext;
      observedAt: string;
      input: PrepareRecurringServicePriceChangeInput;
    }
  ): boolean {
    const requestedInstant = timestampNanoseconds(readInput.observedAt);
    return (
      requestedInstant !== null &&
      timestampNanoseconds(value.observed_at) === requestedInstant &&
      value.context.company_id === readInput.actorContext.companyId &&
      value.request.service_selector === readInput.input.service_selector &&
      value.request.increase_percent === readInput.input.increase_percent &&
      value.request.effective_month === readInput.input.effective_month
    );
  }

  const repository: RecurringServicePriceChangeRepository = {
    async readRecurrenceCatalog(readInput) {
      const data = await executeRead({
        ...readInput,
        phase: "catalog",
        selectedRecurrenceIds: [],
      });
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(data);
      } catch {
        throw new RecurringServicePriceChangeRepositoryUnavailableError();
      }
      const parsed =
        RecurringServicePriceChangeRecurrenceCatalogSchema.safeParse(data);
      if (
        serialized === undefined ||
        serialized.length >
          RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_SNAPSHOT_CHARACTERS ||
        !parsed.success ||
        !matchesReadIdentity(parsed.data, readInput)
      ) {
        throw new RecurringServicePriceChangeRepositoryUnavailableError();
      }
      return parsed.data;
    },
    async readSourceSnapshot(readInput) {
      const data = await executeRead({
        ...readInput,
        phase: "detail",
        selectedRecurrenceIds: readInput.selectedRecurrenceIds,
      });
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(data);
      } catch {
        throw new RecurringServicePriceChangeRepositoryUnavailableError();
      }
      const parsed =
        RecurringServicePriceChangeDetailReadSchema.safeParse(data);
      if (
        serialized === undefined ||
        serialized.length >
          RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_SNAPSHOT_CHARACTERS ||
        !parsed.success ||
        JSON.stringify(parsed.data.catalog).length >
          RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_SNAPSHOT_CHARACTERS ||
        JSON.stringify(parsed.data.snapshot).length >
          RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_SNAPSHOT_CHARACTERS ||
        !matchesReadIdentity(parsed.data.catalog, readInput) ||
        !matchesReadIdentity(parsed.data.snapshot, readInput)
      ) {
        throw new RecurringServicePriceChangeRepositoryUnavailableError();
      }
      return parsed.data;
    },
    async assertCurrentAuthority(assertInput) {
      const request = input.rpc(
        "assert_agent_recurring_service_price_change_authority_as_system",
        binding(assertInput.actorContext)
      );
      const response =
        assertInput.signal && request.abortSignal
          ? await request.abortSignal(assertInput.signal)
          : await request;
      if (response.error) {
        if (isAuthorityDenial(response.error)) {
          throw new RecurringServicePriceChangeRepositoryAuthorityError();
        }
        throw new RecurringServicePriceChangeRepositoryUnavailableError();
      }
      if (
        response.data !== assertInput.actorContext.permissionSnapshotRevision
      ) {
        throw new RecurringServicePriceChangeRepositoryAuthorityError();
      }
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedRecurringServicePriceChangeRepository(
  value: unknown
): value is RecurringServicePriceChangeRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
