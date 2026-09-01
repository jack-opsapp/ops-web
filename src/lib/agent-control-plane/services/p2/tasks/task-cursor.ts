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
import {
  createP2ReadCursorCodec,
  P2ReadCursorError,
  type P2ReadCursorPredecessor,
} from "../shared/cursor";
import type { AuthorizedListTasksRead } from "./task-authorization";

export const TASK_LIST_RANKING_REVISION = "task-ranking:2026-08-22.v1" as const;

const TaskCursorDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const instant = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(instant.getTime()) &&
      instant.toISOString() === `${value}T00:00:00.000Z`
    );
  }, "TASK_CURSOR_DATE_INVALID");

export const TaskListCursorPredecessorSchema = z
  .object({
    order: z.tuple([TaskCursorDateSchema, P2CanonicalUuidSchema]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[1] === predecessor.tie_breaker,
    "TASK_CURSOR_PREDECESSOR_INVALID"
  );

const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: P2DomainRevisionVectorSchema,
  })
  .passthrough()
  .refine(
    (hint) =>
      hint.source_revisions.length === 2 &&
      hint.source_revisions[0]?.domain === "legacy_operational" &&
      hint.source_revisions[1]?.domain === "tasks",
    "TASK_CURSOR_REVISION_VECTOR_INVALID"
  );

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function digest(value: unknown): string {
  try {
    return `sha256:${createHash("sha256")
      .update(
        canonicalOperationalProjection(
          value as Parameters<typeof canonicalOperationalProjection>[0]
        )
      )
      .digest("hex")}`;
  } catch {
    throw new P2ReadCursorError();
  }
}

function scopeDigest(authorization: AuthorizedListTasksRead) {
  return digest({ scope_ceiling: authorization.grantedScopeCeiling });
}

function queryHash(authorization: AuthorizedListTasksRead) {
  return digest({
    view: authorization.query.view,
    limit: authorization.query.limit,
  });
}

function expectation(
  authorization: AuthorizedListTasksRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: TASK_LIST_RANKING_REVISION,
    actorUserId: authorization.actorContext.actorUserId,
    companyId: authorization.actorContext.companyId,
    oauthGrantId: authorization.oauthGrantId,
    grantedScopeDigest: scopeDigest(authorization),
    permissionSnapshotRevision:
      authorization.actorContext.permissionSnapshotRevision,
    queryHash: queryHash(authorization),
    sourceRevisions,
    readAt,
  } as const;
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

export interface TaskListCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly predecessor: P2ReadCursorPredecessor;
}

export interface TaskListCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedListTasksRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: P2ReadCursorPredecessor;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedListTasksRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): TaskListCursorContext;
}

export function createTaskListCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): TaskListCursorService {
  const codec = createP2ReadCursorCodec(input);
  return Object.freeze({
    encode(
      value: {
        readonly authorization: AuthorizedListTasksRead;
        readonly sourceRevisions: readonly P2DomainRevision[];
        readonly readAt: string;
        readonly predecessor: P2ReadCursorPredecessor;
      },
      nowSeconds?: number
    ) {
      const predecessor = TaskListCursorPredecessorSchema.safeParse(
        value.predecessor
      );
      if (!predecessor.success) throw new P2ReadCursorError();
      return codec.encode(
        {
          ...expectation(
            value.authorization,
            value.sourceRevisions,
            value.readAt
          ),
          predecessor: predecessor.data,
        },
        nowSeconds
      );
    },
    decode(
      value: {
        readonly authorization: AuthorizedListTasksRead;
        readonly token: string;
      },
      nowSeconds?: number
    ) {
      const hint = decodeHint(value.token);
      const claims = codec.decode(
        value.token,
        expectation(value.authorization, hint.source_revisions, hint.read_at),
        nowSeconds
      );
      const predecessor = TaskListCursorPredecessorSchema.safeParse(
        claims.predecessor
      );
      if (!predecessor.success) throw new P2ReadCursorError();
      return deepFreeze({
        readAt: claims.read_at,
        sourceRevisions: claims.source_revisions.map((revision) => ({
          ...revision,
        })),
        predecessor: {
          order: [...predecessor.data.order],
          tie_breaker: predecessor.data.tie_breaker,
        },
      });
    },
  });
}

export function taskListQueryHash(authorization: AuthorizedListTasksRead) {
  return queryHash(authorization);
}

export function taskGrantedScopeDigest(authorization: AuthorizedListTasksRead) {
  return scopeDigest(authorization);
}
