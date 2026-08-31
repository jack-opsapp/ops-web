import "server-only";

import { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CollectionsCorrespondenceSchema,
  CollectionsResultSchema,
  type CollectionsResult,
} from "@/lib/agent-control-plane/contracts/collections";
import { IanaTimeZoneSchema } from "@/lib/agent-control-plane/contracts/common";
import { P2CanonicalUuidSchema } from "@/lib/agent-control-plane/contracts/p2-common";
import { COLLECTIONS_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";

const COLLECTIONS_EXPOSURE_REVISION = "2026-08-31.mcp-exposure.v4" as const;
const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface CollectionsRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface CollectionsRpcRequest extends PromiseLike<CollectionsRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<CollectionsRpcResult>;
}

export interface CollectionsRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): CollectionsRpcRequest;
}

const CorrespondenceRowSchema = CollectionsCorrespondenceSchema.safeExtend({
  customer_id: P2CanonicalUuidSchema,
}).strict();

const CorrespondenceRowsSchema = z
  .array(CorrespondenceRowSchema)
  .max(25)
  .refine(
    (rows) =>
      new Set(rows.map((row) => row.customer_id)).size === rows.length &&
      rows.every(
        (row, index) =>
          index === 0 || rows[index - 1]!.customer_id < row.customer_id
      ),
    "COLLECTIONS_CORRESPONDENCE_ROWS_INVALID"
  );

const PersistedSchema = z
  .object({
    result: CollectionsResultSchema,
    replayed: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.result.receipt.replayed === value.replayed,
    "COLLECTIONS_PERSISTENCE_REPLAY_INVALID"
  );

function binding(actorContext: ActorContext) {
  if (
    actorContext.auth.channel !== "mcp" ||
    actorContext.capabilityManifestRevision !==
      COLLECTIONS_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Collections requires a v10 MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_capability_manifest_revision: COLLECTIONS_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: COLLECTIONS_EXPOSURE_REVISION,
  } as const;
}

async function call(
  client: CollectionsRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  signal?: AbortSignal
): Promise<unknown> {
  const request = client.rpc(functionName, args);
  const response =
    signal && request.abortSignal
      ? await request.abortSignal(signal)
      : await request;
  if (response.error) {
    throw new Error("Collections storage is unavailable");
  }
  return response.data;
}

export interface CollectionsCorrespondenceRequest {
  readonly customer_id: string;
  readonly contact_kind: "client" | "sub_client";
  readonly contact_id: string;
  readonly recipient_address: string;
  readonly start_at: string;
}

export type CollectionsCorrespondenceCoverage = z.infer<
  typeof CorrespondenceRowSchema
>;

export interface CollectionsRepository {
  resolveTimezone(
    actorContext: ActorContext,
    signal?: AbortSignal
  ): Promise<string>;
  inspectCorrespondence(input: {
    actorContext: ActorContext;
    recipients: readonly CollectionsCorrespondenceRequest[];
    endAt: string;
    signal?: AbortSignal;
  }): Promise<readonly CollectionsCorrespondenceCoverage[]>;
  persist(input: {
    actorContext: ActorContext;
    asOfDate: string;
    timezone: string;
    idempotencyKey: string;
    inputHash: string;
    resultBase: Readonly<Record<string, unknown>>;
    signal?: AbortSignal;
  }): Promise<CollectionsResult>;
}

export function createCollectionsRepository(
  client: CollectionsRpcClient
): CollectionsRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new TypeError("A collections RPC client is required");
  }
  const repository: CollectionsRepository = {
    async resolveTimezone(actorContext, signal) {
      return IanaTimeZoneSchema.parse(
        await call(
          client,
          "resolve_agent_collections_timezone_as_system",
          binding(actorContext),
          signal
        )
      );
    },
    async inspectCorrespondence(input) {
      if (input.recipients.length === 0) return Object.freeze([]);
      return Object.freeze(
        CorrespondenceRowsSchema.parse(
          await call(
            client,
            "inspect_agent_collections_correspondence_as_system",
            {
              ...binding(input.actorContext),
              p_recipients: input.recipients.map((recipient) => ({
                ...recipient,
              })),
              p_end_at: input.endAt,
            },
            input.signal
          )
        )
      );
    },
    async persist(input) {
      const persisted = PersistedSchema.parse(
        await call(
          client,
          "persist_agent_collections_as_system",
          {
            ...binding(input.actorContext),
            p_as_of_date: input.asOfDate,
            p_timezone: input.timezone,
            p_idempotency_key: input.idempotencyKey,
            p_input_hash: input.inputHash,
            p_result_base: input.resultBase,
          },
          input.signal
        )
      );
      return persisted.result;
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedCollectionsRepository(
  value: unknown
): value is CollectionsRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
