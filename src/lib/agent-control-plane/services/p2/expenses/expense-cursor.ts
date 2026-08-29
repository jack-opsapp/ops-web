import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod-v4";

import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import { createP2ReadCursorCodec, P2ReadCursorError } from "../shared/cursor";
import type { AuthorizedListExpensesRead } from "./expense-authorization";

export const EXPENSE_RANKING_REVISION =
  "expense-ranking:2026-08-22.v1" as const;

const CanonicalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = `${value}T00:00:00.000Z`;
    const instant = new Date(timestamp);
    return (
      !Number.isNaN(instant.getTime()) && instant.toISOString() === timestamp
    );
  });

export const ExpenseCursorPredecessorSchema = z
  .object({
    item_kind: z.enum(["expense", "reimbursement_batch"]),
    order: z.tuple([CanonicalDateSchema, P2CanonicalUuidSchema]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[1] === predecessor.tie_breaker,
    "EXPENSE_CURSOR_PREDECESSOR_INVALID"
  );

const ExactExpenseRevisionVectorSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) => revisions.length === 1 && revisions[0]?.domain === "expenses",
  "EXPENSE_CURSOR_REVISION_VECTOR_INVALID"
);
const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactExpenseRevisionVectorSchema,
  })
  .passthrough();

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function digest(value: unknown): string {
  try {
    return `sha256:${createHash("sha256")
      .update(canonicalOperationalProjection(value as never))
      .digest("hex")}`;
  } catch {
    throw new P2ReadCursorError();
  }
}

function queryHash(authorization: AuthorizedListExpensesRead) {
  return digest({
    view: authorization.query.view,
    limit: authorization.query.limit,
  });
}

function authorityDigest(authorization: AuthorizedListExpensesRead) {
  return digest({
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    authorization_candidate: authorization.authorizationCandidate,
  });
}

function expectation(
  authorization: AuthorizedListExpensesRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: EXPENSE_RANKING_REVISION,
    actorUserId: authorization.actorContext.actorUserId,
    companyId: authorization.actorContext.companyId,
    oauthGrantId: authorization.oauthGrantId,
    grantedScopeDigest: authorityDigest(authorization),
    permissionSnapshotRevision:
      authorization.actorContext.permissionSnapshotRevision,
    queryHash: queryHash(authorization),
    sourceRevisions,
    readAt,
  } as const;
}

function expectedItemKind(authorization: AuthorizedListExpensesRead) {
  return authorization.query.view.kind === "reimbursement_batches"
    ? ("reimbursement_batch" as const)
    : ("expense" as const);
}

function decodeHint(token: string) {
  try {
    if (typeof token !== "string" || token.length > 8_192) {
      throw new P2ReadCursorError();
    }
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "ops_p2_cursor") {
      throw new P2ReadCursorError();
    }
    const payload = parts[1]!;
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new P2ReadCursorError();
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.toString("base64url") !== payload) {
      throw new P2ReadCursorError();
    }
    return CursorHintSchema.parse(JSON.parse(decoded.toString("utf8")));
  } catch (error) {
    if (error instanceof P2ReadCursorError) throw error;
    throw new P2ReadCursorError();
  }
}

export interface ExpenseCursorPredecessor {
  readonly item_kind: "expense" | "reimbursement_batch";
  readonly order: readonly [string, string];
  readonly tie_breaker: string;
}

export interface ExpenseCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly Readonly<{
    domain: "expenses";
    source_revision: number;
  }>[];
  readonly predecessor: ExpenseCursorPredecessor;
}

export interface ExpenseCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedListExpensesRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: ExpenseCursorPredecessor;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedListExpensesRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): ExpenseCursorContext;
}

export function createExpenseCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): ExpenseCursorService {
  const codec = createP2ReadCursorCodec(input);
  const service: ExpenseCursorService = {
    encode(value, nowSeconds?: number) {
      const revisions = ExactExpenseRevisionVectorSchema.safeParse(
        value.sourceRevisions
      );
      const predecessor = ExpenseCursorPredecessorSchema.safeParse(
        value.predecessor
      );
      if (
        !revisions.success ||
        !predecessor.success ||
        predecessor.data.item_kind !== expectedItemKind(value.authorization)
      ) {
        throw new P2ReadCursorError();
      }
      return codec.encode(
        {
          ...expectation(value.authorization, revisions.data, value.readAt),
          predecessor: {
            order: predecessor.data.order,
            tie_breaker: predecessor.data.tie_breaker,
          },
        },
        nowSeconds
      );
    },
    decode(value, nowSeconds?: number) {
      const hint = decodeHint(value.token);
      const claims = codec.decode(
        value.token,
        expectation(value.authorization, hint.source_revisions, hint.read_at),
        nowSeconds
      );
      const revisions = ExactExpenseRevisionVectorSchema.safeParse(
        claims.source_revisions
      );
      const predecessor = ExpenseCursorPredecessorSchema.safeParse({
        item_kind: expectedItemKind(value.authorization),
        order: claims.predecessor.order,
        tie_breaker: claims.predecessor.tie_breaker,
      });
      if (!revisions.success || !predecessor.success) {
        throw new P2ReadCursorError();
      }
      return deepFreeze({
        readAt: claims.read_at,
        sourceRevisions: revisions.data.map((revision) => ({
          domain: "expenses" as const,
          source_revision: revision.source_revision,
        })),
        predecessor: {
          item_kind: predecessor.data.item_kind,
          order: [
            predecessor.data.order[0],
            predecessor.data.order[1],
          ] as const,
          tie_breaker: predecessor.data.tie_breaker,
        },
      });
    },
  };
  return Object.freeze(service);
}

export function expenseListQueryHash(
  authorization: AuthorizedListExpensesRead
) {
  return queryHash(authorization);
}
