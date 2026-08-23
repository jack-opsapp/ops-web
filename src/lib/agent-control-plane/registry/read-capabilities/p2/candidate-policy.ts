import "server-only";

import {
  defineCapabilityPolicyForManifest,
  type ManifestCapabilityPolicy,
  type ManifestCapabilityPolicyDefinition,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import type {
  CapabilityAuthorizationManifest,
  CapabilityAuthorizationSelector,
  CapabilityAuthorizationVariant,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import {
  MCP_SCOPE_OPERATION_BY_ID,
  REGISTERED_MCP_SCOPES,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

export const RESERVED_P2_MANIFEST_REVISION =
  "2026-08-22.capability-manifest.v8" as const;

const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const CAPABILITY_SCHEMA_REVISION_PATTERN = /^\d{4}-\d{2}-\d{2}\.v[1-9][0-9]*$/;
const PROHIBITED_CAPABILITY_NAME_PATTERNS = [
  /(^|_)raw(_|$)/,
  /(^|_)sql(_|$)/,
  /(^|_)record(_|$)/,
  /(^|_)database(_|$)/,
  /(^|_)table(_|$)/,
  /(^|_)crud(_|$)/,
  /^execute_action$/,
  /^fetch_url$/,
  /(^|_)(start_site_visit|complete_site_visit|site_visit_start|site_visit_complete)(_|$)/,
] as const;
const REGISTERED_MCP_SCOPE_SET = new Set<string>(REGISTERED_MCP_SCOPES);

export type P2CandidateCapability = Omit<
  ImplementationOnlyCapabilityDefinition,
  "authorization"
> &
  Readonly<{ authorization: CapabilityAuthorizationManifest }>;

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field}_INVALID`);
  }
}

function assertCandidateDefinition(
  definition: ImplementationOnlyCapabilityDefinition
): void {
  if (
    !CAPABILITY_NAME_PATTERN.test(definition.name) ||
    PROHIBITED_CAPABILITY_NAME_PATTERNS.some((pattern) =>
      pattern.test(definition.name)
    )
  ) {
    throw new TypeError("P2_CANDIDATE_NAME_INVALID");
  }
  if (!CAPABILITY_SCHEMA_REVISION_PATTERN.test(definition.schemaRevision)) {
    throw new TypeError("P2_CANDIDATE_SCHEMA_REVISION_INVALID");
  }
  if (definition.operation !== "read") {
    throw new TypeError("P2_CANDIDATE_MUST_BE_READ_ONLY");
  }
  if (definition.writeFamily !== undefined) {
    throw new TypeError("P2_CANDIDATE_WRITE_FAMILY_INVALID");
  }
  if (definition.description.trim().length === 0) {
    throw new TypeError("P2_CANDIDATE_DESCRIPTION_INVALID");
  }
  if (
    !isRecord(definition.inputSchema) ||
    !("safeParse" in definition.inputSchema) ||
    typeof definition.inputSchema.safeParse !== "function"
  ) {
    throw new TypeError("P2_CANDIDATE_INPUT_SCHEMA_INVALID");
  }
  if (
    !isRecord(definition.availability) ||
    !hasExactKeys(definition.availability, ["implementation"]) ||
    (definition.availability.implementation !== "available" &&
      definition.availability.implementation !== "unavailable")
  ) {
    throw new TypeError("P2_CANDIDATE_AVAILABILITY_INVALID");
  }
  if (
    definition.annotations.readOnlyHint !== true ||
    definition.annotations.destructiveHint !== false ||
    typeof definition.annotations.idempotentHint !== "boolean" ||
    typeof definition.annotations.openWorldHint !== "boolean"
  ) {
    throw new TypeError("P2_CANDIDATE_ANNOTATIONS_INVALID");
  }
  if (
    definition.confirmationPolicy.kind !== "not_required" ||
    definition.idempotencyPolicy.kind !== "inherent"
  ) {
    throw new TypeError("P2_CANDIDATE_CONTROL_POLICY_INVALID");
  }
  assertPositiveSafeInteger(
    definition.bounds.maxInputBytes,
    "P2_CANDIDATE_MAX_INPUT_BYTES"
  );
  assertPositiveSafeInteger(
    definition.bounds.maxOutputCharacters,
    "P2_CANDIDATE_MAX_OUTPUT_CHARACTERS"
  );
  assertPositiveSafeInteger(
    definition.bounds.maxResultItems,
    "P2_CANDIDATE_MAX_RESULT_ITEMS"
  );
  if (
    definition.bounds.maxOutputCharacters > 60_000 ||
    definition.bounds.maxResultItems > 25
  ) {
    throw new TypeError("P2_CANDIDATE_BOUNDS_INVALID");
  }
  if (
    definition.evidencePolicy.output !== "required" ||
    definition.evidencePolicy.promptSafeOutput !== true ||
    definition.evidencePolicy.untrustedExternalContent !==
      "structured_and_marked" ||
    !Number.isSafeInteger(definition.evidencePolicy.maxEvidenceRefs) ||
    definition.evidencePolicy.maxEvidenceRefs < 0
  ) {
    throw new TypeError("P2_CANDIDATE_EVIDENCE_POLICY_INVALID");
  }
  if (definition.rolloutFlag.trim().length === 0) {
    throw new TypeError("P2_CANDIDATE_ROLLOUT_FLAG_INVALID");
  }
  if (
    !Array.isArray(definition.authorization.variants) ||
    definition.authorization.variants.length === 0
  ) {
    throw new TypeError("P2_CANDIDATE_AUTHORIZATION_INVALID");
  }

  const keys = new Set<string>();
  for (const variant of definition.authorization.variants) {
    const key = variant.key.trim();
    if (
      !Array.isArray(variant.requiredOAuthScopes) ||
      variant.requiredOAuthScopes.length === 0
    ) {
      throw new TypeError("P2_CANDIDATE_AUTHORIZATION_INVALID");
    }
    if (
      variant.requiredOAuthScopes.some(
        (scope: unknown) =>
          typeof scope !== "string" ||
          !REGISTERED_MCP_SCOPE_SET.has(scope) ||
          MCP_SCOPE_OPERATION_BY_ID[
            scope as keyof typeof MCP_SCOPE_OPERATION_BY_ID
          ] !== "read"
      )
    ) {
      throw new TypeError("P2_CANDIDATE_OAUTH_SCOPE_INVALID");
    }
    if (!key || keys.has(key) || !isRecord(variant.selector)) {
      throw new TypeError("P2_CANDIDATE_AUTHORIZATION_INVALID");
    }
    keys.add(key);
  }
}

function freezeSelector(
  selector: CapabilityAuthorizationSelector
): CapabilityAuthorizationSelector {
  return Object.freeze({ ...selector });
}

function mintPolicy(
  definition: ImplementationOnlyCapabilityDefinition,
  variant: ImplementationOnlyCapabilityDefinition["authorization"]["variants"][number]
): ManifestCapabilityPolicy {
  const policyDefinition: ManifestCapabilityPolicyDefinition = {
    capabilityId: definition.name,
    capabilityRevision: `${definition.name}:${definition.schemaRevision}`,
    capabilityManifestRevision: RESERVED_P2_MANIFEST_REVISION,
    requiredOAuthScopes: variant.requiredOAuthScopes,
    permissionRequirementGroups: variant.permissionRequirementGroups,
  };
  return defineCapabilityPolicyForManifest(policyDefinition);
}

/** Mints one isolated read candidate with no registration side effect. */
export function mintP2CandidateCapability(
  definition: ImplementationOnlyCapabilityDefinition
): P2CandidateCapability {
  assertCandidateDefinition(definition);

  const variants: readonly CapabilityAuthorizationVariant[] = Object.freeze(
    definition.authorization.variants.map((variant) =>
      Object.freeze({
        key: variant.key.trim(),
        selector: freezeSelector(variant.selector),
        policy: mintPolicy(definition, variant),
      })
    )
  );

  return Object.freeze({
    ...definition,
    bounds: Object.freeze({ ...definition.bounds }),
    evidencePolicy: Object.freeze({ ...definition.evidencePolicy }),
    annotations: Object.freeze({ ...definition.annotations }),
    confirmationPolicy: Object.freeze({ ...definition.confirmationPolicy }),
    idempotencyPolicy: Object.freeze({ ...definition.idempotencyPolicy }),
    availability: Object.freeze({
      implementation: definition.availability.implementation,
    }),
    authorization: Object.freeze({ variants }),
  });
}
