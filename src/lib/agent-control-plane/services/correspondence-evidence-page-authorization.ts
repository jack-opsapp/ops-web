import "server-only";

import type { PermissionScope } from "@/lib/types/permissions";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import type { AuthorizedCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ParsedCorrespondenceEvidenceReadInput } from "@/lib/agent-control-plane/contracts/job-catalog";
import { authorizeTask13CapabilityReadInternal } from "./customer-jobs-authorization";

const CAPABILITY_ID = "get_correspondence_evidence" as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_CORRESPONDENCE_EVIDENCE_PAGE_READ: unique symbol;

export interface AuthorizedCorrespondenceEvidencePageRead {
  readonly [AUTHORIZED_CORRESPONDENCE_EVIDENCE_PAGE_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly inboxScope: "all" | "assigned" | "own";
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
  readonly query: ParsedCorrespondenceEvidenceReadInput;
}

function scope<T extends PermissionScope>(
  value: PermissionScope | undefined,
  allowed: readonly T[]
): T | null {
  return value && allowed.includes(value as T) ? (value as T) : null;
}

export function authorizeCorrespondenceEvidencePageRead(input: {
  readonly authorizations:
    AuthorizedCapability | readonly AuthorizedCapability[];
  readonly rawInput: unknown;
}): AuthorizedCorrespondenceEvidencePageRead {
  const base = authorizeTask13CapabilityReadInternal<
    typeof CAPABILITY_ID,
    ParsedCorrespondenceEvidenceReadInput
  >({
    capabilityId: CAPABILITY_ID,
    errorNamespace: "correspondence_evidence",
    ...input,
  });
  const inboxScope = scope(base.resolvedPermissions["inbox.view"], [
    "all",
    "assigned",
    "own",
  ]);
  const pipelineScope = scope(base.resolvedPermissions["pipeline.view"], [
    "all",
    "assigned",
  ]);
  const projectsScope = scope(base.resolvedPermissions["projects.view"], [
    "all",
    "assigned",
  ]);
  if (
    !inboxScope ||
    (base.query.job_ref.kind === "opportunity" && !pipelineScope) ||
    (base.query.job_ref.kind === "project" && !projectsScope)
  ) {
    throw authorizationInternal(
      base.actorContext.requestId,
      "correspondence_evidence_permission_union_invalid"
    );
  }

  const proof = Object.freeze({
    actorContext: base.actorContext,
    capabilityId: base.capabilityId,
    capabilityRevision: base.capabilityRevision,
    capabilityManifestRevision: base.capabilityManifestRevision,
    requiredOAuthScopes: base.requiredOAuthScopes,
    inboxScope,
    pipelineScope,
    projectsScope,
    query: base.query,
  });
  PROOFS.add(proof);
  return proof as unknown as AuthorizedCorrespondenceEvidencePageRead;
}

export function isAuthorizedCorrespondenceEvidencePageRead(
  value: unknown
): value is AuthorizedCorrespondenceEvidencePageRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
