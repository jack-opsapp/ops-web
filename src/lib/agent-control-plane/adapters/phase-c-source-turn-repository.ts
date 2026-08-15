import "server-only";

import { types as nodeTypes } from "node:util";

import { snapshotExactOwnEnumerableData } from "@/lib/agent-control-plane/actor/exact-own-data-snapshot";

const arrayIsArray = Array.isArray;
const isProxy = nodeTypes.isProxy;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectFreeze = Object.freeze;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (
  pattern: RegExp,
  value: string
) => boolean;
const descriptorIntrinsic = getOwnPropertyDescriptor(
  Object,
  "getOwnPropertyDescriptors"
);

function sourceDecoderIntrinsicsAreCurrent(): boolean {
  const current = getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptors");
  return Boolean(
    descriptorIntrinsic &&
    current &&
    "value" in descriptorIntrinsic &&
    "value" in current &&
    descriptorIntrinsic.value === current.value
  );
}

const PHASE_C_SOURCE_TURN_RPC = "read_phase_c_source_turn_as_system" as const;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PROVIDER_THREAD_ID_BYTES = 512;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SOURCE_TURN_INPUT_KEYS = [
  "companyId",
  "opportunityId",
  "actorUserId",
  "assignmentVersion",
  "connectionId",
  "internalThreadId",
  "providerThreadId",
  "sourceActivityId",
] as const;
const SOURCE_TURN_ROW_KEYS = ["turn_id", "conversation_id"] as const;

export interface PhaseCSourceTurnReadInput {
  readonly companyId: string;
  readonly opportunityId: string;
  readonly actorUserId: string;
  readonly assignmentVersion: number;
  readonly connectionId: string;
  readonly internalThreadId: string;
  readonly providerThreadId: string;
  readonly sourceActivityId: string;
}

export interface PhaseCSourceTurn {
  readonly turnId: string;
  readonly conversationId: string;
}

interface PhaseCSourceTurnRpcArguments extends Readonly<
  Record<string, unknown>
> {
  readonly p_company_id: string;
  readonly p_opportunity_id: string;
  readonly p_actor_user_id: string;
  readonly p_assignment_version: number;
  readonly p_connection_id: string;
  readonly p_internal_thread_id: string;
  readonly p_provider_thread_id: string;
  readonly p_source_activity_id: string;
}

export interface PhaseCSourceTurnRpcClient {
  rpc(
    functionName: typeof PHASE_C_SOURCE_TURN_RPC,
    args: PhaseCSourceTurnRpcArguments
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

declare const TRUSTED_PHASE_C_SOURCE_TURN_ADAPTER: unique symbol;
interface TrustedPhaseCSourceTurnAdapterBrand {
  readonly [TRUSTED_PHASE_C_SOURCE_TURN_ADAPTER]: true;
}

interface TrustedPhaseCSourceTurnReadAdapter extends TrustedPhaseCSourceTurnAdapterBrand {
  read(input: PhaseCSourceTurnReadInput): Promise<unknown>;
}

declare const TRUSTED_PHASE_C_SOURCE_TURN_REPOSITORY: unique symbol;
interface TrustedPhaseCSourceTurnRepositoryBrand {
  readonly [TRUSTED_PHASE_C_SOURCE_TURN_REPOSITORY]: true;
}

export interface PhaseCSourceTurnRepository {
  resolve(input: PhaseCSourceTurnReadInput): Promise<PhaseCSourceTurn>;
}

export type TrustedPhaseCSourceTurnRepository = PhaseCSourceTurnRepository &
  TrustedPhaseCSourceTurnRepositoryBrand;

const TRUSTED_ADAPTERS = new WeakSet<object>();
const TRUSTED_REPOSITORIES = new WeakSet<object>();
const VALIDATED_INPUTS = new WeakSet<object>();

export class PhaseCSourceTurnUnavailableError extends Error {
  readonly code = "PHASE_C_SOURCE_TURN_UNAVAILABLE" as const;

  constructor(cause?: unknown) {
    super("The exact delivered Phase C source turn is unavailable.", {
      ...(cause === undefined ? {} : { cause }),
    });
    this.name = "PhaseCSourceTurnUnavailableError";
  }
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && regexpTest(CANONICAL_UUID_PATTERN, value);
}

function exactOwnDataValues(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | null {
  return snapshotExactOwnEnumerableData(value, expectedKeys);
}

function snapshotValidInput(input: unknown): PhaseCSourceTurnReadInput {
  const values = exactOwnDataValues(input, SOURCE_TURN_INPUT_KEYS);
  const companyId = values?.companyId;
  const opportunityId = values?.opportunityId;
  const actorUserId = values?.actorUserId;
  const assignmentVersion = values?.assignmentVersion;
  const connectionId = values?.connectionId;
  const internalThreadId = values?.internalThreadId;
  const providerThreadId = values?.providerThreadId;
  const sourceActivityId = values?.sourceActivityId;
  if (
    !isCanonicalUuid(companyId) ||
    !isCanonicalUuid(opportunityId) ||
    !isCanonicalUuid(actorUserId) ||
    !Number.isSafeInteger(assignmentVersion) ||
    (assignmentVersion as number) < 0 ||
    !isCanonicalUuid(connectionId) ||
    !isCanonicalUuid(internalThreadId) ||
    !isCanonicalUuid(sourceActivityId) ||
    typeof providerThreadId !== "string" ||
    providerThreadId.length < 1 ||
    new TextEncoder().encode(providerThreadId).byteLength >
      MAX_PROVIDER_THREAD_ID_BYTES ||
    providerThreadId.trim() !== providerThreadId ||
    CONTROL_CHARACTER_PATTERN.test(providerThreadId)
  ) {
    throw new TypeError("PHASE_C_SOURCE_TURN_INPUT_INVALID");
  }
  const snapshot = Object.freeze({
    companyId,
    opportunityId,
    actorUserId,
    assignmentVersion: assignmentVersion as number,
    connectionId,
    internalThreadId,
    providerThreadId,
    sourceActivityId,
  });
  VALIDATED_INPUTS.add(snapshot);
  return snapshot;
}

function isValidatedInput(value: unknown): value is PhaseCSourceTurnReadInput {
  return (
    typeof value === "object" && value !== null && VALIDATED_INPUTS.has(value)
  );
}

function isTrustedAdapter(
  value: unknown
): value is TrustedPhaseCSourceTurnReadAdapter {
  return (
    typeof value === "object" && value !== null && TRUSTED_ADAPTERS.has(value)
  );
}

function decodeSourceTurn(raw: unknown): PhaseCSourceTurn {
  if (!arrayIsArray(raw) || isProxy(raw)) {
    throw new PhaseCSourceTurnUnavailableError();
  }
  let row: unknown;
  try {
    const descriptors = getOwnPropertyDescriptors(raw);
    const descriptorRecord = descriptors as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const keys = reflectOwnKeys(descriptors);
    const rowDescriptor = descriptorRecord["0"];
    const lengthDescriptor = descriptorRecord["length"];
    if (
      keys.length !== 2 ||
      !rowDescriptor ||
      !("value" in rowDescriptor) ||
      !rowDescriptor.enumerable ||
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== 1
    ) {
      throw new PhaseCSourceTurnUnavailableError();
    }
    row = rowDescriptor.value;
  } catch {
    throw new PhaseCSourceTurnUnavailableError();
  }
  const record = exactOwnDataValues(row, SOURCE_TURN_ROW_KEYS);
  if (
    !record ||
    !isCanonicalUuid(record.turn_id) ||
    !isCanonicalUuid(record.conversation_id)
  ) {
    throw new PhaseCSourceTurnUnavailableError();
  }
  return objectFreeze({
    turnId: record.turn_id,
    conversationId: record.conversation_id,
  });
}

function snapshotRpcEnvelope(value: unknown): {
  readonly data: unknown;
  readonly error: unknown;
} {
  if (typeof value !== "object" || value === null || isProxy(value)) {
    throw new PhaseCSourceTurnUnavailableError();
  }
  try {
    const descriptors = getOwnPropertyDescriptors(value);
    const descriptorRecord = descriptors as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const dataDescriptor = descriptorRecord.data;
    const errorDescriptor = descriptorRecord.error;
    if (
      !dataDescriptor ||
      !("value" in dataDescriptor) ||
      !dataDescriptor.enumerable ||
      !errorDescriptor ||
      !("value" in errorDescriptor) ||
      !errorDescriptor.enumerable
    ) {
      throw new PhaseCSourceTurnUnavailableError();
    }
    return objectFreeze({
      data: dataDescriptor.value,
      error: errorDescriptor.value,
    });
  } catch {
    throw new PhaseCSourceTurnUnavailableError();
  }
}

export function createSupabasePhaseCSourceTurnReadAdapter(
  client: PhaseCSourceTurnRpcClient
): TrustedPhaseCSourceTurnReadAdapter {
  const rpc = client?.rpc;
  if (typeof rpc !== "function") {
    throw new TypeError("A Phase C source-turn RPC client is required");
  }
  const adapter = {
    async read(input: PhaseCSourceTurnReadInput): Promise<unknown> {
      if (!isValidatedInput(input)) {
        throw new TypeError("PHASE_C_SOURCE_TURN_INPUT_INVALID");
      }
      const rawResponse = await rpc.call(
        client,
        PHASE_C_SOURCE_TURN_RPC,
        Object.freeze({
          p_company_id: input.companyId,
          p_opportunity_id: input.opportunityId,
          p_actor_user_id: input.actorUserId,
          p_assignment_version: input.assignmentVersion,
          p_connection_id: input.connectionId,
          p_internal_thread_id: input.internalThreadId,
          p_provider_thread_id: input.providerThreadId,
          p_source_activity_id: input.sourceActivityId,
        })
      );
      if (!sourceDecoderIntrinsicsAreCurrent()) {
        throw new PhaseCSourceTurnUnavailableError();
      }
      const response = snapshotRpcEnvelope(rawResponse);
      if (response.error) {
        throw new PhaseCSourceTurnUnavailableError(response.error);
      }
      return response.data;
    },
  };
  TRUSTED_ADAPTERS.add(adapter);
  return Object.freeze(adapter) as TrustedPhaseCSourceTurnReadAdapter;
}

export function createPhaseCSourceTurnRepository(
  adapter: TrustedPhaseCSourceTurnReadAdapter
): TrustedPhaseCSourceTurnRepository {
  if (!isTrustedAdapter(adapter)) {
    throw new TypeError("A trusted Phase C source-turn adapter is required");
  }
  const read = adapter.read;
  const repository = {
    async resolve(input: PhaseCSourceTurnReadInput): Promise<PhaseCSourceTurn> {
      const snapshot = snapshotValidInput(input);
      try {
        return decodeSourceTurn(await read.call(adapter, snapshot));
      } catch (error) {
        if (error instanceof PhaseCSourceTurnUnavailableError) {
          throw error;
        }
        throw new PhaseCSourceTurnUnavailableError(error);
      }
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as TrustedPhaseCSourceTurnRepository;
}

export function isTrustedPhaseCSourceTurnRepository(
  value: unknown
): value is TrustedPhaseCSourceTurnRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
