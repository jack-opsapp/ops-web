import "server-only";

import {
  activateCapabilityPolicyForManifest,
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
  type ImplementationOnlyCapabilityDefinition,
  type LegacyCapabilityManifestEntry,
} from "./capability-types";
import {
  CURRENT_PRODUCTION_READ_CAPABILITIES,
  V7_READ_CAPABILITY_DEFINITIONS,
} from "./read-capabilities";
import {
  P2_READ_CAPABILITY_CANDIDATES,
  RESERVED_P2_MANIFEST_REVISION,
} from "./read-capabilities/p2";
import { WRITE_CAPABILITY_DEFINITIONS } from "./write-tools";
import {
  COMMIT_DAY_CLOSEOUT_CAPABILITY_DEFINITION,
  DAY_CLOSEOUT_CAPABILITY_DEFINITION,
} from "./day-closeout-capability";
import {
  COMMIT_COLLECTIONS_DRAFT_CAPABILITY_DEFINITION,
  PREPARE_COLLECTIONS_CAPABILITY_DEFINITION,
} from "./collections-capability";
import { ANALYZE_HIRING_BREAK_EVEN_CAPABILITY_DEFINITION } from "./hiring-what-if-capability";
import { PROMISE_RECOVERY_CAPABILITY_DEFINITION } from "./promise-recovery-capability";
import { ANALYZE_SALES_TRUTH_CAPABILITY_DEFINITION } from "./sales-truth-capability";

export const V7_CAPABILITY_MANIFEST_REVISION =
  "2026-08-20.capability-manifest.v7" as const;
export const CAPABILITY_MANIFEST_REVISION = RESERVED_P2_MANIFEST_REVISION;
export const INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION =
  "2026-08-30.capability-manifest.v9" as const;
export const COLLECTIONS_CAPABILITY_MANIFEST_REVISION =
  "2026-08-31.capability-manifest.v10" as const;
export const HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION =
  "2026-08-31.capability-manifest.v11" as const;
export const PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION =
  "2026-09-01.capability-manifest.v12" as const;
export const SALES_TRUTH_CAPABILITY_MANIFEST_REVISION =
  "2026-09-01.capability-manifest.v13" as const;

function activateManifestPolicies(
  entries: readonly CapabilityManifestEntry[]
): void {
  for (const entry of entries) {
    for (const variant of entry.authorization.variants) {
      activateCapabilityPolicyForManifest(variant.policy);
    }
  }
}

function freezeSelector(
  selector: CapabilityAuthorizationSelector
): CapabilityAuthorizationSelector {
  return Object.freeze({ ...selector });
}

function mintPolicy(
  capability: Pick<
    CapabilityDefinition,
    "name" | "schemaRevision" | "authorization"
  >,
  variant: CapabilityDefinition["authorization"]["variants"][number],
  manifestRevision: string
): ManifestCapabilityPolicy {
  const definition: ManifestCapabilityPolicyDefinition = {
    capabilityId: capability.name,
    capabilityRevision: `${capability.name}:${capability.schemaRevision}`,
    capabilityManifestRevision: manifestRevision,
    requiredOAuthScopes: variant.requiredOAuthScopes,
    permissionRequirementGroups: variant.permissionRequirementGroups,
  };
  return defineCapabilityPolicyForManifest(definition);
}

function mintVariants(
  definition: Pick<
    CapabilityDefinition,
    "name" | "schemaRevision" | "authorization"
  >,
  manifestRevision: string
): readonly CapabilityAuthorizationVariant[] {
  return Object.freeze(
    definition.authorization.variants.map((variant) =>
      Object.freeze({
        key: variant.key,
        selector: freezeSelector(variant.selector),
        policy: mintPolicy(definition, variant, manifestRevision),
      })
    )
  );
}

function mintV7Entry(
  definition: CapabilityDefinition
): LegacyCapabilityManifestEntry {
  const variants: readonly CapabilityAuthorizationVariant[] = Object.freeze(
    definition.authorization.variants.map((variant) =>
      Object.freeze({
        key: variant.key,
        selector: freezeSelector(variant.selector),
        policy: mintPolicy(
          definition,
          variant,
          V7_CAPABILITY_MANIFEST_REVISION
        ),
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

function mintV8Entry(
  definition: CapabilityDefinition
): CapabilityManifestEntry {
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
    authorization: Object.freeze({
      variants: mintVariants(definition, CAPABILITY_MANIFEST_REVISION),
    }),
  });
}

function remintEntry(
  entry: CapabilityManifestEntry,
  manifestRevision: string
): CapabilityManifestEntry {
  return Object.freeze({
    ...entry,
    bounds: Object.freeze({ ...entry.bounds }),
    evidencePolicy: Object.freeze({ ...entry.evidencePolicy }),
    annotations: Object.freeze({ ...entry.annotations }),
    confirmationPolicy: Object.freeze({ ...entry.confirmationPolicy }),
    idempotencyPolicy: Object.freeze({ ...entry.idempotencyPolicy }),
    availability: Object.freeze({ ...entry.availability }),
    authorization: Object.freeze({
      variants: Object.freeze(
        entry.authorization.variants.map((variant) =>
          Object.freeze({
            key: variant.key,
            selector: freezeSelector(variant.selector),
            policy: defineCapabilityPolicyForManifest({
              capabilityId: entry.name,
              capabilityRevision: `${entry.name}:${entry.schemaRevision}`,
              capabilityManifestRevision: manifestRevision,
              requiredOAuthScopes: variant.policy.requiredOAuthScopes,
              permissionRequirementGroups:
                variant.policy.permissionRequirementGroups,
            }),
          })
        )
      ),
    }),
  });
}

function mintImplementationEntry(
  definition: ImplementationOnlyCapabilityDefinition,
  manifestRevision: string
): CapabilityManifestEntry {
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
    authorization: Object.freeze({
      variants: mintVariants(definition, manifestRevision),
    }),
  });
}

const v7Definitions: readonly CapabilityDefinition[] = [
  ...V7_READ_CAPABILITY_DEFINITIONS,
  ...WRITE_CAPABILITY_DEFINITIONS,
];
const v7ManifestEntries = v7Definitions.map(mintV7Entry);
assertCapabilityManifestInvariants(
  v7ManifestEntries,
  V7_CAPABILITY_MANIFEST_REVISION
);
activateManifestPolicies(v7ManifestEntries);

export const V7_CAPABILITY_MANIFEST: readonly LegacyCapabilityManifestEntry[] =
  Object.freeze(v7ManifestEntries);

const V7_CAPABILITY_BY_NAME = new Map(
  V7_CAPABILITY_MANIFEST.map((entry) => [entry.name, entry] as const)
);

const manifestEntries: readonly CapabilityManifestEntry[] = [
  ...CURRENT_PRODUCTION_READ_CAPABILITIES.map(mintV8Entry),
  ...P2_READ_CAPABILITY_CANDIDATES,
  ...WRITE_CAPABILITY_DEFINITIONS.map(mintV8Entry),
];
assertCapabilityManifestInvariants(
  manifestEntries,
  CAPABILITY_MANIFEST_REVISION
);
activateManifestPolicies(manifestEntries);

export const CAPABILITY_MANIFEST: readonly CapabilityManifestEntry[] =
  Object.freeze(manifestEntries);

const CAPABILITY_BY_NAME = new Map(
  CAPABILITY_MANIFEST.map((entry) => [entry.name, entry] as const)
);

const invisibleOfficeManifestEntries: readonly CapabilityManifestEntry[] = [
  ...CAPABILITY_MANIFEST.map((entry) =>
    remintEntry(entry, INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION)
  ),
  mintImplementationEntry(
    DAY_CLOSEOUT_CAPABILITY_DEFINITION,
    INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION
  ),
  mintImplementationEntry(
    COMMIT_DAY_CLOSEOUT_CAPABILITY_DEFINITION,
    INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION
  ),
];
assertCapabilityManifestInvariants(
  invisibleOfficeManifestEntries,
  INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION
);
activateManifestPolicies(invisibleOfficeManifestEntries);

export const INVISIBLE_OFFICE_CAPABILITY_MANIFEST: readonly CapabilityManifestEntry[] =
  Object.freeze(invisibleOfficeManifestEntries);

const INVISIBLE_OFFICE_CAPABILITY_BY_NAME = new Map(
  INVISIBLE_OFFICE_CAPABILITY_MANIFEST.map(
    (entry) => [entry.name, entry] as const
  )
);

const collectionsManifestEntries: readonly CapabilityManifestEntry[] = [
  ...INVISIBLE_OFFICE_CAPABILITY_MANIFEST.map((entry) =>
    remintEntry(entry, COLLECTIONS_CAPABILITY_MANIFEST_REVISION)
  ),
  mintImplementationEntry(
    PREPARE_COLLECTIONS_CAPABILITY_DEFINITION,
    COLLECTIONS_CAPABILITY_MANIFEST_REVISION
  ),
  mintImplementationEntry(
    COMMIT_COLLECTIONS_DRAFT_CAPABILITY_DEFINITION,
    COLLECTIONS_CAPABILITY_MANIFEST_REVISION
  ),
];
assertCapabilityManifestInvariants(
  collectionsManifestEntries,
  COLLECTIONS_CAPABILITY_MANIFEST_REVISION
);
activateManifestPolicies(collectionsManifestEntries);

export const COLLECTIONS_CAPABILITY_MANIFEST: readonly CapabilityManifestEntry[] =
  Object.freeze(collectionsManifestEntries);

const COLLECTIONS_CAPABILITY_BY_NAME = new Map(
  COLLECTIONS_CAPABILITY_MANIFEST.map((entry) => [entry.name, entry] as const)
);

const hiringWhatIfManifestEntries: readonly CapabilityManifestEntry[] = [
  ...COLLECTIONS_CAPABILITY_MANIFEST.map((entry) =>
    remintEntry(entry, HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION)
  ),
  mintImplementationEntry(
    ANALYZE_HIRING_BREAK_EVEN_CAPABILITY_DEFINITION,
    HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION
  ),
];
assertCapabilityManifestInvariants(
  hiringWhatIfManifestEntries,
  HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION
);
activateManifestPolicies(hiringWhatIfManifestEntries);

export const HIRING_WHAT_IF_CAPABILITY_MANIFEST: readonly CapabilityManifestEntry[] =
  Object.freeze(hiringWhatIfManifestEntries);

const HIRING_WHAT_IF_CAPABILITY_BY_NAME = new Map(
  HIRING_WHAT_IF_CAPABILITY_MANIFEST.map(
    (entry) => [entry.name, entry] as const
  )
);

const promiseRecoveryManifestEntries: readonly CapabilityManifestEntry[] = [
  ...HIRING_WHAT_IF_CAPABILITY_MANIFEST.map((entry) =>
    remintEntry(entry, PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION)
  ),
  mintImplementationEntry(
    PROMISE_RECOVERY_CAPABILITY_DEFINITION,
    PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION
  ),
];
assertCapabilityManifestInvariants(
  promiseRecoveryManifestEntries,
  PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION
);
activateManifestPolicies(promiseRecoveryManifestEntries);

export const PROMISE_RECOVERY_CAPABILITY_MANIFEST: readonly CapabilityManifestEntry[] =
  Object.freeze(promiseRecoveryManifestEntries);

const PROMISE_RECOVERY_CAPABILITY_BY_NAME = new Map(
  PROMISE_RECOVERY_CAPABILITY_MANIFEST.map(
    (entry) => [entry.name, entry] as const
  )
);

const salesTruthManifestEntries: readonly CapabilityManifestEntry[] = [
  ...PROMISE_RECOVERY_CAPABILITY_MANIFEST.map((entry) =>
    remintEntry(entry, SALES_TRUTH_CAPABILITY_MANIFEST_REVISION)
  ),
  mintImplementationEntry(
    ANALYZE_SALES_TRUTH_CAPABILITY_DEFINITION,
    SALES_TRUTH_CAPABILITY_MANIFEST_REVISION
  ),
];
assertCapabilityManifestInvariants(
  salesTruthManifestEntries,
  SALES_TRUTH_CAPABILITY_MANIFEST_REVISION
);
activateManifestPolicies(salesTruthManifestEntries);

export const SALES_TRUTH_CAPABILITY_MANIFEST: readonly CapabilityManifestEntry[] =
  Object.freeze(salesTruthManifestEntries);

const SALES_TRUTH_CAPABILITY_BY_NAME = new Map(
  SALES_TRUTH_CAPABILITY_MANIFEST.map((entry) => [entry.name, entry] as const)
);

export function getCapabilityManifestEntry(
  name: string
): CapabilityManifestEntry {
  const entry = CAPABILITY_BY_NAME.get(name);
  if (!entry) throw new TypeError("Unknown capability");
  return entry;
}

export function getInvisibleOfficeCapabilityManifestEntry(
  name: string
): CapabilityManifestEntry {
  const entry = INVISIBLE_OFFICE_CAPABILITY_BY_NAME.get(name);
  if (!entry) throw new TypeError("Unknown capability");
  return entry;
}

export function getCollectionsCapabilityManifestEntry(
  name: string
): CapabilityManifestEntry {
  const entry = COLLECTIONS_CAPABILITY_BY_NAME.get(name);
  if (!entry) throw new TypeError("Unknown capability");
  return entry;
}

export function getHiringWhatIfCapabilityManifestEntry(
  name: string
): CapabilityManifestEntry {
  const entry = HIRING_WHAT_IF_CAPABILITY_BY_NAME.get(name);
  if (!entry) throw new TypeError("Unknown capability");
  return entry;
}

export function getPromiseRecoveryCapabilityManifestEntry(
  name: string
): CapabilityManifestEntry {
  const entry = PROMISE_RECOVERY_CAPABILITY_BY_NAME.get(name);
  if (!entry) throw new TypeError("Unknown capability");
  return entry;
}

export function getSalesTruthCapabilityManifestEntry(
  name: string
): CapabilityManifestEntry {
  const entry = SALES_TRUTH_CAPABILITY_BY_NAME.get(name);
  if (!entry) throw new TypeError("Unknown capability");
  return entry;
}

export function getV7CapabilityManifestEntry(
  name: string
): LegacyCapabilityManifestEntry {
  const entry = V7_CAPABILITY_BY_NAME.get(name);
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
  if (selector.kind === "always" || selector.kind === "input_always") {
    return true;
  }

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

  if (selector.kind === "input_object_discriminator") {
    const selected = parsedInput[selector.field];
    return (
      isRecord(selected) && selected[selector.discriminator] === selector.value
    );
  }

  if (selector.kind === "input_array_object_discriminator") {
    const selected = parsedInput[selector.field];
    return (
      Array.isArray(selected) &&
      selected.some(
        (value) =>
          isRecord(value) && value[selector.discriminator] === selector.value
      )
    );
  }

  if (selector.kind === "input_source_kind") {
    const sourceKinds = parsedInput.source_kinds;
    return Array.isArray(sourceKinds)
      ? sourceKinds.includes(selector.value)
      : parsedInput.source_kind === selector.value;
  }

  if (selector.kind === "input_source_and_job_kind") {
    const reference = parsedInput.job_ref;
    if (!isRecord(reference) || reference.kind !== selector.jobKind) {
      return false;
    }
    if ("source" in selector) {
      return parsedInput.source === selector.source;
    }
    const sourceKinds = parsedInput.source_kinds;
    return Array.isArray(sourceKinds)
      ? sourceKinds.includes(selector.sourceKind)
      : parsedInput.source_kind === selector.sourceKind;
  }

  if (selector.kind === "site_visit_context_artifact_sections") {
    const sections = parsedInput[selector.field];
    return (
      parsedInput.anchor === selector.anchor &&
      Array.isArray(sections) &&
      selector.values.every((value) => sections.includes(value))
    );
  }

  if (
    selector.kind === "operational_overview_component" ||
    selector.kind === "work_queue_source"
  ) {
    const selected = parsedInput[selector.field];
    return selected === undefined
      ? selector.defaultWhenOmitted
      : Array.isArray(selected) && selected.includes(selector.value);
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

function resolveAuthorizationFromEntry(
  capability: CapabilityManifestEntry,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
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

/**
 * Parses caller input first, then selects only manifest-owned policy variants.
 * Callers can choose domain arguments; they cannot submit a permission or
 * policy name. A handler must authorize every returned variant before reading.
 */
export function resolveCapabilityAuthorization(
  capabilityName: string,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
  return resolveAuthorizationFromEntry(
    getCapabilityManifestEntry(capabilityName),
    rawInput
  );
}

export function resolveInvisibleOfficeCapabilityAuthorization(
  capabilityName: string,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
  return resolveAuthorizationFromEntry(
    getInvisibleOfficeCapabilityManifestEntry(capabilityName),
    rawInput
  );
}

export function resolveCollectionsCapabilityAuthorization(
  capabilityName: string,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
  return resolveAuthorizationFromEntry(
    getCollectionsCapabilityManifestEntry(capabilityName),
    rawInput
  );
}

export function resolveHiringWhatIfCapabilityAuthorization(
  capabilityName: string,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
  return resolveAuthorizationFromEntry(
    getHiringWhatIfCapabilityManifestEntry(capabilityName),
    rawInput
  );
}

export function resolvePromiseRecoveryCapabilityAuthorization(
  capabilityName: string,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
  return resolveAuthorizationFromEntry(
    getPromiseRecoveryCapabilityManifestEntry(capabilityName),
    rawInput
  );
}

export function resolveSalesTruthCapabilityAuthorization(
  capabilityName: string,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
  return resolveAuthorizationFromEntry(
    getSalesTruthCapabilityManifestEntry(capabilityName),
    rawInput
  );
}

/**
 * Compatibility-only resolver for proving the frozen v7 authorization bytes.
 * Runtime callers must use resolveCapabilityAuthorization and the active
 * manifest revision.
 */
export function resolveV7CapabilityAuthorization(
  capabilityName: string,
  rawInput: unknown
): ResolvedCapabilityAuthorization {
  return resolveAuthorizationFromEntry(
    getV7CapabilityManifestEntry(capabilityName),
    rawInput
  );
}
