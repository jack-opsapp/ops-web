import "server-only";

import type { PermissionScope } from "@/lib/types/permissions";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type { ParsedScheduledJobsInput } from "@/lib/agent-control-plane/contracts/schedule";

const CAPABILITY_ID = "list_scheduled_jobs" as const;
const REQUIRED_SCOPES = ["ops.jobs.read", "ops.schedule.read"] as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_SCHEDULED_JOBS_READ: unique symbol;

export interface AuthorizedScheduledJobsRead {
  readonly [AUTHORIZED_SCHEDULED_JOBS_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly calendarScope: "all" | "own";
  readonly projectsScope: "all" | "assigned";
  readonly tasksScope: "all" | "assigned";
  readonly query: ParsedScheduledJobsInput;
}

function same<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[]
) {
  return same(Object.keys(value).sort(), [...expected].sort());
}

function scope<T extends PermissionScope>(
  value: PermissionScope | undefined,
  allowed: readonly T[]
): T | null {
  return value && allowed.includes(value as T) ? (value as T) : null;
}

export function authorizeScheduledJobsRead(input: {
  readonly authorization: AuthorizedCapability;
  readonly rawInput: unknown;
}): AuthorizedScheduledJobsRead {
  if (!isAuthorizedCapability(input.authorization)) {
    throw authorizationInternal(
      "unknown-request",
      "scheduled_jobs_capability_untrusted"
    );
  }
  const { actorContext } = input.authorization;
  let resolved: ReturnType<typeof resolveCapabilityAuthorization>;
  try {
    resolved = resolveCapabilityAuthorization(CAPABILITY_ID, input.rawInput);
  } catch {
    throw authorizationInternal(
      actorContext.requestId,
      "scheduled_jobs_input_untrusted"
    );
  }
  const variant = resolved.variants[0];
  const expectedPermissionKeys = [
    "calendar.view",
    "projects.view",
    "tasks.view",
  ] as const;
  const calendarScope = scope(
    input.authorization.resolvedPermissions["calendar.view"],
    ["all", "own"]
  );
  const projectsScope = scope(
    input.authorization.resolvedPermissions["projects.view"],
    ["all", "assigned"]
  );
  const tasksScope = scope(
    input.authorization.resolvedPermissions["tasks.view"],
    ["all", "assigned"]
  );
  if (
    resolved.capability.name !== CAPABILITY_ID ||
    resolved.variants.length !== 1 ||
    variant?.key !== "schedule" ||
    input.authorization.capabilityId !== CAPABILITY_ID ||
    input.authorization.capabilityRevision !==
      variant.policy.capabilityRevision ||
    input.authorization.capabilityManifestRevision !==
      CAPABILITY_MANIFEST_REVISION ||
    !same(variant.policy.requiredOAuthScopes, REQUIRED_SCOPES) ||
    !same(input.authorization.declaredPermissions, expectedPermissionKeys) ||
    !exactKeys(
      input.authorization.resolvedPermissions,
      expectedPermissionKeys
    ) ||
    !same(input.authorization.satisfiedPermissionGroupIndexes, [0]) ||
    !same(
      input.authorization.satisfiedOAuthScopes,
      actorContext.auth.channel === "mcp" ? REQUIRED_SCOPES : []
    ) ||
    !calendarScope ||
    !projectsScope ||
    !tasksScope
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "scheduled_jobs_capability_identity_mismatch"
    );
  }
  const proof = {
    actorContext,
    capabilityId: CAPABILITY_ID,
    capabilityRevision: variant.policy.capabilityRevision,
    capabilityManifestRevision: variant.policy.capabilityManifestRevision,
    requiredOAuthScopes: Object.freeze([...REQUIRED_SCOPES]),
    calendarScope,
    projectsScope,
    tasksScope,
    query: Object.freeze({
      ...(resolved.parsedInput as ParsedScheduledJobsInput),
      task_statuses: Object.freeze([
        ...(resolved.parsedInput as ParsedScheduledJobsInput).task_statuses,
      ]),
      ...((resolved.parsedInput as ParsedScheduledJobsInput).confirmation_states
        ? {
            confirmation_states: Object.freeze([
              ...(resolved.parsedInput as ParsedScheduledJobsInput)
                .confirmation_states!,
            ]),
          }
        : {}),
    }),
  };
  PROOFS.add(proof);
  return Object.freeze(proof) as unknown as AuthorizedScheduledJobsRead;
}

export function isAuthorizedScheduledJobsRead(
  value: unknown
): value is AuthorizedScheduledJobsRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
