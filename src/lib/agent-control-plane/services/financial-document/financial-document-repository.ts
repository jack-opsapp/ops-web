import { z } from "zod-v4";
import "server-only";
import type { ActorContext } from "../../actor/resolve-actor-context";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "../../actor/authority-repository";
import {
  FinancialDocumentContextSchema,
  FinancialDocumentResultSchema,
  FINANCIAL_DOCUMENT_CAPABILITY_REVISION,
  type FinancialDocumentResult,
  InspectFinancialDocumentInputSchema,
  type PrepareFinancialDocumentInput,
} from "../../contracts/financial-document";
import { FINANCIAL_DOCUMENT_CAPABILITY_MANIFEST_REVISION } from "../../registry/capability-manifest";
import { MCP_EXPOSURE_V17 } from "../../registry/mcp-exposure-catalog";
import type { ScheduleChangeRpcClient } from "../schedule-change/schedule-change-repository";

const trusted = new WeakSet<object>();
export class FinancialDocumentRepositoryError extends Error {
  constructor(
    readonly code:
      | "CONFLICT"
      | "NO_CHANGE"
      | "POLICY"
      | "STALE"
      | "UNAVAILABLE",
    cause?: unknown
  ) {
    super("Financial document preparation is unavailable.", { cause });
  }
}
function binding(actor: ActorContext) {
  if (
    actor.auth.channel !== "mcp" ||
    actor.capabilityManifestRevision !==
      FINANCIAL_DOCUMENT_CAPABILITY_MANIFEST_REVISION
  )
    throw new TypeError("A current financial-document MCP actor is required");
  return {
    p_actor_user_id: actor.actorUserId,
    p_company_id: actor.companyId,
    p_oauth_grant_id: actor.auth.oauthGrantId,
    p_oauth_client_id: actor.auth.oauthClientId,
    p_grant_revision: actor.auth.grantRevision,
    p_granted_scope_ceiling: [...actor.auth.scopeCeiling],
    p_permission_snapshot_revision: actor.permissionSnapshotRevision,
    p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    p_capability_manifest_revision:
      FINANCIAL_DOCUMENT_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: MCP_EXPOSURE_V17.revision,
    p_capability_id: "prepare_financial_document",
    p_capability_revision: FINANCIAL_DOCUMENT_CAPABILITY_REVISION,
  };
}
export interface FinancialDocumentRepository {
  inspect(
    actor: ActorContext,
    request: z.infer<typeof InspectFinancialDocumentInputSchema>,
    signal?: AbortSignal
  ): Promise<z.infer<typeof FinancialDocumentContextSchema>>;
  prepare(input: {
    actorContext: ActorContext;
    request: PrepareFinancialDocumentInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<FinancialDocumentResult>;
}
// Compare JSON semantically: PostgreSQL emits keys in a different order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}`;
  return JSON.stringify(value);
}
export function createFinancialDocumentRepository(input: {
  rpc: ScheduleChangeRpcClient["rpc"];
}): FinancialDocumentRepository {
  if (typeof input.rpc !== "function")
    throw new TypeError("A trusted RPC client is required");
  const repository: FinancialDocumentRepository = {
    async inspect(actor, request, signal) {
      const call = input.rpc("inspect_financial_document_as_system", {
        ...binding(actor),
        p_request: request,
      });
      const response = await (signal && call.abortSignal
        ? call.abortSignal(signal)
        : call);
      if (
        response.error ||
        (JSON.stringify(response.data) ?? "").length > 262144
      )
        throw new FinancialDocumentRepositoryError(
          "UNAVAILABLE",
          response.error
        );
      const result = FinancialDocumentContextSchema.parse(response.data);
      if (
        result.client_id !== request.client_id ||
        result.target_id !== (request.project_id ?? request.opportunity_id)
      )
        throw new FinancialDocumentRepositoryError("UNAVAILABLE");
      const expected = new Set([
        ...request.product_ids.map((id) => `catalog:${id}`),
        ...request.historical_line_ids.map((id) => `historical_line:${id}`),
        ...request.estimate_ids.map((id) => `estimate:${id}`),
        ...request.project_note_ids.map((id) => `project_note:${id}`),
      ]);
      const actual = result.sources.map(
        (source) => `${source.kind}:${source.id}`
      );
      if (
        actual.length !== expected.size ||
        new Set(actual).size !== actual.length ||
        actual.some((id) => !expected.has(id))
      )
        throw new FinancialDocumentRepositoryError("UNAVAILABLE");
      return Object.freeze(result);
    },
    async prepare(read) {
      const call = input.rpc("prepare_financial_document_as_system", {
        ...binding(read.actorContext),
        p_request_id: read.actorContext.requestId,
        p_request: read.request,
      });
      const response = await (read.signal && call.abortSignal
        ? call.abortSignal(read.signal)
        : call);
      if (response.error) {
        const message =
          typeof response.error === "object" &&
          response.error !== null &&
          "message" in response.error
            ? String(response.error.message)
            : "";
        throw new FinancialDocumentRepositoryError(
          message.includes("IDEMPOTENCY_CONFLICT")
            ? "CONFLICT"
            : message.includes("POLICY")
              ? "POLICY"
              : /STALE|AUTHORITY|GRANT/.test(message)
                ? "STALE"
                : "UNAVAILABLE",
          response.error
        );
      }
      if ((JSON.stringify(response.data) ?? "").length > 262144)
        throw new FinancialDocumentRepositoryError("UNAVAILABLE");
      const parsed = FinancialDocumentResultSchema.safeParse(response.data);
      if (
        !parsed.success ||
        parsed.data.request_id !== read.actorContext.requestId ||
        canonical(parsed.data.proposal.request) !== canonical(read.request)
      )
        throw new FinancialDocumentRepositoryError("UNAVAILABLE");
      return Object.freeze(parsed.data);
    },
  };
  trusted.add(repository);
  return Object.freeze(repository);
}
export function isTrustedFinancialDocumentRepository(
  value: unknown
): value is FinancialDocumentRepository {
  return typeof value === "object" && value !== null && trusted.has(value);
}
