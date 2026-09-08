import "server-only";
import { z } from "zod-v4";
import {
  FinancialPolicyRequestSchema,
  FinancialPolicyPreviewSchema,
  FinancialPolicyReadinessSchema,
  FinancialPolicyReceiptSchema,
} from "../../contracts/financial-policy";

type Identity = { actorId: string; companyId: string };
type Rpc = (
  name: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: unknown }>;
const IdentitySchema = z.strictObject({
  actorId: z.uuid(),
  companyId: z.uuid(),
});
const safeCodes = [
  "OWNER_REQUIRED",
  "PERMISSION_DENIED",
  "INPUT_INVALID",
  "CURRENCY_UNAVAILABLE",
  "TAX_UNAVAILABLE",
  "SOURCE_STALE",
  "PRIOR_STALE",
  "PREVIEW_EXPIRED",
  "PREVIEW_UNAVAILABLE",
  "REVISION_EXISTS",
  "REPLAY_STALE",
  "RATE_LIMITED",
] as const;
export class FinancialPolicyService {
  constructor(private readonly rpc: Rpc) {}
  private async call(
    name: string,
    identity: Identity,
    args: Record<string, unknown>
  ) {
    IdentitySchema.parse(identity);
    const response = await this.rpc(name, {
      p_actor: identity.actorId,
      p_company: identity.companyId,
      ...args,
    });
    if (response.error) {
      const message =
        typeof response.error === "object" && "message" in response.error
          ? String(response.error.message)
          : "";
      const code = safeCodes.find((c) => message === `FINANCIAL_POLICY_${c}`);
      throw new Error(
        code ? `FINANCIAL_POLICY_${code}` : "FINANCIAL_POLICY_UNAVAILABLE"
      );
    }
    if (!response.data || JSON.stringify(response.data).length > 131072)
      throw new Error("FINANCIAL_POLICY_UNAVAILABLE");
    return response.data;
  }
  async readiness(identity: Identity, sourceId?: string) {
    if (sourceId !== undefined) z.uuid().parse(sourceId);
    const result = parseResult(
      FinancialPolicyReadinessSchema,
      await this.call("get_financial_policy_readiness_as_actor", identity, {
        p_source: sourceId ?? null,
      })
    );
    if (
      result.company_id !== identity.companyId ||
      result.actor_user_id !== identity.actorId ||
      (sourceId && result.source && result.source.id !== sourceId)
    )
      throw new Error("FINANCIAL_POLICY_UNAVAILABLE");
    return result;
  }
  async decide(identity: Identity, raw: unknown) {
    const request = FinancialPolicyRequestSchema.parse(raw);
    if (request.action === "preview") {
      const result = parseResult(
        FinancialPolicyPreviewSchema,
        await this.call("preview_financial_policy_as_actor", identity, {
          p_request: request.policy,
        })
      );
      if (
        result.operation !== "enroll" ||
        result.company_id !== identity.companyId ||
        result.actor_user_id !== identity.actorId ||
        result.source.id !== request.policy.source_document_id ||
        result.source.sha256 !== request.policy.source_sha256 ||
        !equal(result.policy, request.policy)
      )
        throw new Error("FINANCIAL_POLICY_UNAVAILABLE");
      return result;
    }
    const args =
      request.action === "enroll"
        ? { p_preview: request.preview_id, p_sha256: request.preview_sha256 }
        : { p_policy: request.policy_id, p_sha256: request.policy_sha256 };
    const result = parseResult(
      FinancialPolicyReceiptSchema,
      await this.call(
        request.action === "enroll"
          ? "enroll_financial_policy_as_actor"
          : "revoke_financial_policy_as_actor",
        identity,
        args
      )
    );
    if (
      result.company_id !== identity.companyId ||
      result.actor_user_id !== identity.actorId ||
      result.operation !== request.action ||
      (request.action === "enroll" &&
        result.preview_id !== request.preview_id) ||
      (request.action === "revoke" && result.policy_id !== request.policy_id)
    )
      throw new Error("FINANCIAL_POLICY_UNAVAILABLE");
    return result;
  }
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>;
    return (
      Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every(
        (k) => Object.hasOwn(right, k) && equal(left[k], right[k])
      )
    );
  }
  return false;
}

function parseResult<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("FINANCIAL_POLICY_UNAVAILABLE");
  return parsed.data;
}
