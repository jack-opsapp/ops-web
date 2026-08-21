import "server-only";

import {
  defineCapabilityPolicyForManifest,
  type ManifestCapabilityPolicy,
  type ManifestCapabilityPolicyDefinition,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  assertCapabilityManifestInvariants,
  type CapabilityAuthorizationSelector,
  type CapabilityAuthorizationVariant,
  type CapabilityDefinition,
  type CapabilityManifestEntry,
} from "./capability-types";
import { READ_CAPABILITY_DEFINITIONS } from "./read-tools";
import { WRITE_CAPABILITY_DEFINITIONS } from "./write-tools";

export const CAPABILITY_MANIFEST_REVISION =
  "2026-08-20.capability-manifest.v7" as const;

function freezeSelector(
  selector: CapabilityAuthorizationSelector
): CapabilityAuthorizationSelector {
  return Object.freeze({ ...selector });
}

function mintPolicy(
  capability: CapabilityDefinition,
  variant: CapabilityDefinition["authorization"]["variants"][number]
): ManifestCapabilityPolicy {
  const definition: ManifestCapabilityPolicyDefinition = {
    capabilityId: capability.name,
    capabilityRevision: `${capability.name}:${capability.schemaRevision}`,
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
    requiredOAuthScopes: variant.requiredOAuthScopes,
    permissionRequirementGroups: variant.permissionRequirementGroups,
  };
  return defineCapabilityPolicyForManifest(definition);
}

function mintEntry(definition: CapabilityDefinition): CapabilityManifestEntry {
  const variants: readonly CapabilityAuthorizationVariant[] = Object.freeze(
    definition.authorization.variants.map((variant) =>
      Object.freeze({
        key: variant.key,
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
    availability: Object.freeze({ ...definition.availability }),
    authorization: Object.freeze({ variants }),
  });
}

const definitions: readonly CapabilityDefinition[] = [
  ...READ_CAPABILITY_DEFINITIONS,
  ...WRITE_CAPABILITY_DEFINITIONS,
];
const manifestEntries = definitions.map(mintEntry);
assertCapabilityManifestInvariants(
  manifestEntries,
  CAPABILITY_MANIFEST_REVISION
);

export const CAPABILITY_MANIFEST: readonly CapabilityManifestEntry[] =
  Object.freeze(manifestEntries);

const CAPABILITY_BY_NAME = new Map(
  CAPABILITY_MANIFEST.map((entry) => [entry.name, entry] as const)
);

export function getCapabilityManifestEntry(
  name: string
): CapabilityManifestEntry {
  const entry = CAPABILITY_BY_NAME.get(name);
  if (!entry) throw new TypeError("Unknown capability");
  return entry;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectorMatches(
  selector: CapabilityAuthorizationSelector,
  parsedInput: Readonly<Record<string, unknown>>
): boolean {
  if (selector.kind === "always") return true;

  if (selector.kind === "customer_discovery_lookup") {
    const lookup = parsedInput.lookup;
    return selector.lookup === "name"
      ? lookup === "name"
      : lookup === "exact_email" || lookup === "exact_phone";
  }

  if (selector.kind === "job_discovery_kind") {
    const jobKinds = parsedInput.job_kinds;
    return Array.isArray(jobKinds) && jobKinds.includes(selector.jobKind);
  }

  if (selector.kind === "customer_job_kind") {
    const jobKinds = parsedInput.job_kinds;
    return Array.isArray(jobKinds) && jobKinds.includes(selector.jobKind);
  }

  if (selector.kind === "job_history_scope") {
    const scope = parsedInput.scope;
    return isRecord(scope) && scope.kind === selector.scopeKind;
  }

  if (selector.kind === "job_history_job_kind") {
    const scope = parsedInput.scope;
    if (!isRecord(scope)) return false;
    if (scope.kind === "customer") {
      return (
        Array.isArray(scope.job_kinds) &&
        scope.job_kinds.includes(selector.jobKind)
      );
    }
    if (scope.kind !== "jobs" || !Array.isArray(scope.job_refs)) return false;
    return scope.job_refs.some(
      (reference) => isRecord(reference) && reference.kind === selector.jobKind
    );
  }

  if (selector.kind === "job_history_source_authority") {
    const sourceTypes = parsedInput.source_types;
    if (!Array.isArray(sourceTypes)) return false;
    if (selector.authority === "correspondence") {
      return sourceTypes.some(
        (sourceType) =>
          sourceType === "delivered_correspondence" ||
          sourceType === "current_memory_summary"
      );
    }
    return sourceTypes.includes(selector.authority);
  }

  if (selector.kind === "job_history_financial_source") {
    const sourceTypes = parsedInput.source_types;
    const scope = parsedInput.scope;
    if (
      !Array.isArray(sourceTypes) ||
      !sourceTypes.includes("estimate_document") ||
      !isRecord(scope)
    ) {
      return false;
    }
    if (scope.kind === "customer") {
      return (
        Array.isArray(scope.job_kinds) &&
        scope.job_kinds.includes(selector.jobKind)
      );
    }
    return (
      scope.kind === "jobs" &&
      Array.isArray(scope.job_refs) &&
      scope.job_refs.some(
        (reference) =>
          isRecord(reference) && reference.kind === selector.jobKind
      )
    );
  }

  if (selector.kind === "job_summary_readiness") {
    const jobRef = parsedInput.job_ref;
    const sections = parsedInput.sections;
    const rules = parsedInput.readiness_rule_codes;
    if (
      !isRecord(jobRef) ||
      jobRef.kind !== "project" ||
      !Array.isArray(sections) ||
      !sections.includes("readiness") ||
      !Array.isArray(rules)
    ) {
      return false;
    }
    if (selector.authority === "site_photos") {
      return rules.includes("SITE_PHOTOS_MISSING");
    }
    if (selector.authority === "customer") {
      return rules.includes("CUSTOMER_RECORD_UNRESOLVED");
    }
    return rules.some((rule) =>
      ["SCHEDULE_UNCONFIRMED", "CREW_UNASSIGNED"].includes(rule as string)
    );
  }

  if (selector.kind === "job_summary_financial_component") {
    const jobRef = parsedInput.job_ref;
    const sections = parsedInput.sections;
    const components = parsedInput.financial_components;
    return (
      isRecord(jobRef) &&
      jobRef.kind === selector.jobKind &&
      Array.isArray(sections) &&
      sections.includes("financials") &&
      Array.isArray(components) &&
      components.includes(selector.component)
    );
  }

  if (selector.kind === "input_array_contains") {
    const values = parsedInput[selector.field];
    return Array.isArray(values) && values.includes(selector.value);
  }

  if (selector.kind === "input_value") {
    return parsedInput[selector.field] === selector.value;
  }

  const jobRef = parsedInput.job_ref;
  if (!isRecord(jobRef) || jobRef.kind !== selector.jobKind) return false;
  if (selector.kind === "job_kind") return true;
  if (
    selector.kind === "job_purpose" ||
    selector.kind === "job_participant_purpose"
  ) {
    return parsedInput.purpose === selector.purpose;
  }

  const sections = parsedInput.sections;
  return Array.isArray(sections) && sections.includes(selector.section);
}

function deepFreezeParsedInput<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeParsedInput(item);
    return Object.freeze(value) as T;
  }
  for (const item of Object.values(value)) deepFreezeParsedInput(item);
  return Object.freeze(value) as T;
}

export interface ResolvedCapabilityAuthorization {
  readonly capability: CapabilityManifestEntry;
  readonly parsedInput: Readonly<Record<string, unknown>>;
  readonly variants: readonly CapabilityAuthorizationVariant[];
}

/**
 * Parses caller input first, then selects only manifest-owned policy variants.
 * Callers can choose domain arguments; they cannot submit a permission or
 * policy name. A handler must authorize every returned variant before reading.
 */
export function resolveCapabilityAuthorization(
  capabilityName: string,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
  const capability = getCapabilityManifestEntry(capabilityName);
  const parsed = capability.inputSchema.parse(rawInput);
  if (!isRecord(parsed)) {
    throw new TypeError("Capability input must resolve to an object");
  }

  const parsedInput = deepFreezeParsedInput(parsed);
  const variants = Object.freeze(
    capability.authorization.variants.filter((variant) =>
      selectorMatches(variant.selector, parsedInput)
    )
  );
  if (variants.length === 0) {
    throw new TypeError("No authorization policy matches the parsed input");
  }

  return Object.freeze({ capability, parsedInput, variants });
}
