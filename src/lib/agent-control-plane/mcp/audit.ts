import "server-only";

import { createHash } from "node:crypto";

import { appendRequestAudit, type McpOAuthRpcClient } from "./oauth";

export type McpAuditOutcome =
  | "ok"
  | "domain_error"
  | "unauthenticated"
  | "forbidden"
  | "rate_limited"
  | "internal";

export interface McpAuditRecord {
  readonly requestId: string;
  readonly grantId: string | null;
  readonly clientId: string | null;
  readonly actorUserId: string | null;
  readonly companyId: string | null;
  readonly tool: string | null;
  readonly protocolEra: string | null;
  readonly outcome: McpAuditOutcome;
  readonly errorCode: string | null;
  readonly inputSha256: string | null;
  readonly resultBytes: number | null;
  readonly latencyMs: number | null;
}

export function auditInputDigest(input: unknown): string | null {
  try {
    return createHash("sha256")
      .update(JSON.stringify(input ?? null), "utf8")
      .digest("hex");
  } catch {
    return null;
  }
}

/**
 * Append one immutable audit row. Auditing must never take the request down
 * with it — failures degrade to a structured console line so the Vercel log
 * drain still carries the event.
 */
export async function recordMcpAudit(
  rpcClient: McpOAuthRpcClient,
  record: McpAuditRecord
): Promise<void> {
  try {
    await appendRequestAudit(rpcClient, record);
  } catch {
    console.error(
      JSON.stringify({
        at: "mcp_request_audit_fallback",
        requestId: record.requestId,
        outcome: record.outcome,
        tool: record.tool,
        errorCode: record.errorCode,
      })
    );
  }
}
