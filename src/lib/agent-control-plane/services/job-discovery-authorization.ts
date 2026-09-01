import "server-only";

import type { AuthorizedCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import type { ParsedSearchJobsInput } from "@/lib/agent-control-plane/contracts/discovery";
import { authorizeTask13CapabilityReadInternal } from "./customer-jobs-authorization";

const CAPABILITY_ID = "search_jobs" as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_JOB_DISCOVERY_READ: unique symbol;

export interface AuthorizedJobDiscoveryRead {
  readonly [AUTHORIZED_JOB_DISCOVERY_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
  readonly query: ParsedSearchJobsInput;
}

function jobScope(value: unknown): "all" | "assigned" | null {
  return value === "all" || value === "assigned" ? value : null;
}

export function authorizeJobDiscoveryRead(input: {
  readonly authorizations: readonly AuthorizedCapability[];
  readonly rawInput: unknown;
}): AuthorizedJobDiscoveryRead {
  const base = authorizeTask13CapabilityReadInternal<
    typeof CAPABILITY_ID,
    ParsedSearchJobsInput
  >({
    capabilityId: CAPABILITY_ID,
    errorNamespace: "job_discovery",
    authorizations: input.authorizations,
    rawInput: input.rawInput,
  });
  const pipelineScope = jobScope(base.resolvedPermissions["pipeline.view"]);
  const projectsScope = jobScope(base.resolvedPermissions["projects.view"]);
  if (
    (base.query.job_kinds.includes("opportunity") && !pipelineScope) ||
    (base.query.job_kinds.includes("project") && !projectsScope)
  ) {
    throw authorizationInternal(
      base.actorContext.requestId,
      "job_discovery_permission_union_invalid"
    );
  }

  const proof = Object.freeze({
    actorContext: base.actorContext,
    capabilityId: base.capabilityId,
    capabilityRevision: base.capabilityRevision,
    capabilityManifestRevision: base.capabilityManifestRevision,
    requiredOAuthScopes: base.requiredOAuthScopes,
    pipelineScope,
    projectsScope,
    query: base.query,
  });
  PROOFS.add(proof);
  return proof as unknown as AuthorizedJobDiscoveryRead;
}

export function isAuthorizedJobDiscoveryRead(
  value: unknown
): value is AuthorizedJobDiscoveryRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
