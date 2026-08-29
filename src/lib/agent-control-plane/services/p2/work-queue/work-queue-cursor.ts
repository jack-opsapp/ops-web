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
import type { AuthorizedWorkQueueRead } from "./work-queue-authorization";

export const WORK_QUEUE_RANKING_REVISION =
  "work-queue-ranking:2026-08-22.v1" as const;
export const WorkQueueCursorPredecessorSchema = z
  .object({
    order: z.tuple([
      z.number().int().min(0).max(99),
      P2CanonicalTimestampSchema,
      z.string().min(1).max(32),
      P2CanonicalUuidSchema,
    ]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (value) => value.order[3] === value.tie_breaker,
    "WORK_QUEUE_CURSOR_PREDECESSOR_INVALID"
  );
const HintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: z
      .array(
        z.object({ domain: z.string(), source_revision: z.number() }).strict()
      )
      .max(64),
  })
  .passthrough();
function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(canonicalOperationalProjection(value as never))
    .digest("hex")}`;
}
function expectation(
  authorization: AuthorizedWorkQueueRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: WORK_QUEUE_RANKING_REVISION,
    actorUserId: authorization.actorContext.actorUserId,
    companyId: authorization.actorContext.companyId,
    oauthGrantId: authorization.oauthGrantId,
    oauthClientId: authorization.oauthClientId,
    grantRevision: authorization.grantRevision,
    grantedScopeDigest: digest({
      scope_ceiling: authorization.grantedScopeCeiling,
      oauth_client_id: authorization.oauthClientId,
      grant_revision: authorization.grantRevision,
    }),
    permissionSnapshotRevision:
      authorization.actorContext.permissionSnapshotRevision,
    queryHash: digest({
      sources: authorization.selections,
      authorized_sources: authorization.authorizedSources.map((source) => ({
        source: source.source,
        origin: source.origin,
        required_oauth_scopes: source.requiredOAuthScopes,
        resolved_permission_scopes: source.resolvedPermissionScopes,
        satisfied_permission_group_indexes:
          source.satisfiedPermissionGroupIndexes,
      })),
      limit: authorization.query.limit,
    }),
    sourceRevisions,
    readAt,
  } as const;
}
function hint(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw 0;
    return HintSchema.parse(
      JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"))
    );
  } catch {
    throw new P2ReadCursorError();
  }
}
export interface WorkQueueCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly predecessor: z.infer<typeof WorkQueueCursorPredecessorSchema>;
}
export function createWorkQueueCursorService(input: {
  keyId: string;
  key: Uint8Array;
}) {
  const codec = createP2ReadCursorCodec(input);
  return Object.freeze({
    encode(
      value: {
        authorization: AuthorizedWorkQueueRead;
        sourceRevisions: readonly P2DomainRevision[];
        readAt: string;
        predecessor: z.infer<typeof WorkQueueCursorPredecessorSchema>;
      },
      nowSeconds?: number
    ) {
      const predecessor = WorkQueueCursorPredecessorSchema.parse(
        value.predecessor
      );
      return codec.encode(
        {
          ...expectation(
            value.authorization,
            value.sourceRevisions,
            value.readAt
          ),
          predecessor,
        },
        nowSeconds
      );
    },
    decode(
      value: { authorization: AuthorizedWorkQueueRead; token: string },
      nowSeconds?: number
    ): WorkQueueCursorContext {
      const decodedHint = hint(value.token);
      const revisions = P2DomainRevisionVectorSchema.parse(
        decodedHint.source_revisions
      );
      const claims = codec.decode(
        value.token,
        expectation(value.authorization, revisions, decodedHint.read_at),
        nowSeconds
      );
      return Object.freeze({
        readAt: claims.read_at,
        sourceRevisions: claims.source_revisions,
        predecessor: WorkQueueCursorPredecessorSchema.parse(claims.predecessor),
      });
    },
  });
}
