import type { z } from "zod-v4";

import {
  isManifestCapabilityPolicy,
  type CapabilityPermissionRequirement,
  type ManifestCapabilityPolicy,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";
/*
 * This is deliberately not an open string registry. Adding a scope changes
 * the external consent surface and must ship as a reviewed manifest revision.
 */
export const CAPABILITY_OAUTH_SCOPES = Object.freeze([
  "ops.catalog.prepare",
  "ops.catalog.read",
  "ops.catalog.write",
  "ops.communications.prepare",
  "ops.communications.send",
  "ops.correspondence.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.financials.prepare",
  "ops.financials.read",
  "ops.financials.write",
  "ops.jobs.prepare",
  "ops.jobs.read",
  "ops.jobs.write",
  "ops.photos.read",
  "ops.schedule.prepare",
  "ops.schedule.read",
  "ops.schedule.write",
] as const);

const CAPABILITY_OAUTH_SCOPE_SET = new Set<string>(CAPABILITY_OAUTH_SCOPES);

export type CapabilityOperation = "read" | "prepare" | "commit";
export type CapabilityRiskTier = "low" | "medium" | "high" | "critical";
export type CapabilityImplementationAvailability = "unavailable" | "available";
export type CapabilityExternalExposure = "disabled" | "enabled";
export type CapabilityAuditClass =
  | "operational_read"
  | "sensitive_read"
  | "evidence_read"
  | "search_read"
  | "mutation_prepare"
  | "mutation_commit"
  | "external_commit";
export type CapabilityRateLimitBucket =
  "lightweight_read" | "evidence_search" | "prepare" | "commit";

/** Structural subset of the MCP ToolAnnotations contract. */
export interface CapabilityMcpAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface CapabilityBounds {
  readonly maxInputBytes: number;
  readonly maxOutputCharacters: number;
  readonly maxResultItems: number;
  readonly maxWindowDays?: number;
  readonly maxBatchItems?: number;
}

export interface CapabilityEvidencePolicy {
  readonly input:
    "not_required" | "optional" | "required" | "prepared_change_set";
  readonly output: "required";
  readonly maxEvidenceRefs: number;
  readonly promptSafeOutput: true;
  readonly untrustedExternalContent: "structured_and_marked";
}

export type CapabilityConfirmationPolicy =
  | Readonly<{ kind: "not_required" }>
  | Readonly<{
      kind: "change_set_preview";
      exactPreviewRequired: true;
      expires: true;
    }>
  | Readonly<{
      kind: "confirmation_receipt";
      prepareCapability: string;
      exactPreviewRequired: true;
      singleUse: true;
    }>;

export type CapabilityIdempotencyPolicy =
  | Readonly<{ kind: "inherent" }>
  | Readonly<{
      kind: "required";
      keyField: "idempotency_key";
      conflictOnArgumentsHashMismatch: true;
    }>;

export type CapabilityAuthorizationSelector =
  | Readonly<{ kind: "always" }>
  | Readonly<{
      kind: "job_kind";
      jobKind: "opportunity" | "project";
    }>
  | Readonly<{
      kind: "job_section";
      jobKind: "opportunity" | "project";
      section:
        | "schedule"
        | "readiness"
        | "participants"
        | "financials"
        | "activity"
        | "conversation";
    }>
  | Readonly<{
      kind: "job_purpose";
      jobKind: "opportunity" | "project";
      purpose: "schedule_notice" | "photo_request" | "general";
    }>
  | Readonly<{
      kind: "input_value";
      field: "mode";
      value: "import" | "edit";
    }>
  | Readonly<{
      kind: "input_value";
      field: "view";
      value: "booked_appointments" | "visit_history";
    }>
  | Readonly<{
      kind: "input_value";
      field: "include_unlinked";
      value: true;
    }>
  | Readonly<{
      kind: "input_value";
      field: "anchor";
      value: "opportunity" | "unlinked";
    }>;

export interface CapabilityAuthorizationVariantDefinition {
  readonly key: string;
  readonly selector: CapabilityAuthorizationSelector;
  readonly requiredOAuthScopes: readonly string[];
  /** AND within one group; OR across groups. */
  readonly permissionRequirementGroups: readonly (readonly CapabilityPermissionRequirement[])[];
}

export interface CapabilityAuthorizationDefinition {
  readonly variants: readonly CapabilityAuthorizationVariantDefinition[];
}

export interface CapabilityAuthorizationVariant {
  readonly key: string;
  readonly selector: CapabilityAuthorizationSelector;
  readonly policy: ManifestCapabilityPolicy;
}

export interface CapabilityAuthorizationManifest {
  readonly variants: readonly CapabilityAuthorizationVariant[];
}

interface CapabilityBase {
  readonly name: string;
  readonly schemaRevision: string;
  readonly operation: CapabilityOperation;
  readonly writeFamily?: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly riskTier: CapabilityRiskTier;
  readonly bounds: CapabilityBounds;
  readonly evidencePolicy: CapabilityEvidencePolicy;
  readonly auditClass: CapabilityAuditClass;
  readonly rateLimitBucket: CapabilityRateLimitBucket;
  readonly annotations: CapabilityMcpAnnotations;
  readonly confirmationPolicy: CapabilityConfirmationPolicy;
  readonly idempotencyPolicy: CapabilityIdempotencyPolicy;
  readonly availability: Readonly<{
    implementation: CapabilityImplementationAvailability;
    externalExposure: CapabilityExternalExposure;
  }>;
  readonly rolloutFlag: string;
}

export interface CapabilityDefinition extends CapabilityBase {
  readonly authorization: CapabilityAuthorizationDefinition;
}

export interface CapabilityManifestEntry extends CapabilityBase {
  readonly authorization: CapabilityAuthorizationManifest;
}

const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const GENERIC_CAPABILITY_PATTERNS = [
  /(^|_)raw(_|$)/,
  /(^|_)sql(_|$)/,
  /(^|_)record(_|$)/,
  /(^|_)database(_|$)/,
  /(^|_)table(_|$)/,
  /(^|_)crud(_|$)/,
  /^execute_action$/,
  /^fetch_url$/,
] as const;
const PROHIBITED_DOMAIN_CAPABILITY_PATTERNS = [
  /(^|_)(start_site_visit|complete_site_visit|site_visit_start|site_visit_complete)(_|$)/,
] as const;

function requiredNonBlank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

function assertAnnotations(entry: CapabilityManifestEntry): void {
  const annotations = entry.annotations;
  for (const field of [
    "readOnlyHint",
    "destructiveHint",
    "idempotentHint",
    "openWorldHint",
  ] as const) {
    if (typeof annotations[field] !== "boolean") {
      throw new TypeError(`${entry.name}.${field} must be boolean`);
    }
  }

  if (entry.operation === "read") {
    if (!annotations.readOnlyHint || annotations.destructiveHint) {
      throw new TypeError(`${entry.name} has invalid read annotations`);
    }
    return;
  }

  if (annotations.readOnlyHint) {
    throw new TypeError(`${entry.name} writes cannot be read-only`);
  }
  if (entry.operation === "prepare" && annotations.destructiveHint) {
    throw new TypeError(`${entry.name} prepare cannot be destructive`);
  }
}

function assertAuthorization(
  entry: CapabilityManifestEntry,
  manifestRevision: string
): void {
  if (
    !Array.isArray(entry.authorization.variants) ||
    entry.authorization.variants.length === 0
  ) {
    throw new TypeError(`${entry.name} requires authorization variants`);
  }

  const keys = new Set<string>();
  for (const variant of entry.authorization.variants) {
    const key = requiredNonBlank(variant.key, `${entry.name}.variant.key`);
    if (keys.has(key)) {
      throw new TypeError(`${entry.name} has a duplicate policy variant`);
    }
    keys.add(key);
    if (
      typeof variant.selector !== "object" ||
      variant.selector === null ||
      typeof variant.selector.kind !== "string"
    ) {
      throw new TypeError(`${entry.name}.${key} has an invalid selector`);
    }

    const policy = variant.policy;
    if (!isManifestCapabilityPolicy(policy)) {
      throw new TypeError(`${entry.name}.${key} policy is not manifest-owned`);
    }
    if (
      policy.capabilityId !== entry.name ||
      policy.capabilityRevision !== `${entry.name}:${entry.schemaRevision}` ||
      policy.capabilityManifestRevision !== manifestRevision
    ) {
      throw new TypeError(`${entry.name}.${key} policy identity is invalid`);
    }
    if (
      policy.requiredOAuthScopes.length === 0 ||
      policy.permissionRequirementGroups.length === 0
    ) {
      throw new TypeError(`${entry.name}.${key} policy is empty`);
    }
    if (
      policy.requiredOAuthScopes.some(
        (scope) => !CAPABILITY_OAUTH_SCOPE_SET.has(scope)
      )
    ) {
      throw new TypeError(
        `${entry.name}.${key} uses an unregistered OAuth scope`
      );
    }
  }
}

function assertConfirmation(entry: CapabilityManifestEntry): void {
  if (entry.operation === "read") {
    if (
      entry.confirmationPolicy.kind !== "not_required" ||
      entry.idempotencyPolicy.kind !== "inherent" ||
      entry.writeFamily !== undefined
    ) {
      throw new TypeError(`${entry.name} has invalid read control policy`);
    }
    return;
  }

  requiredNonBlank(entry.writeFamily, `${entry.name}.writeFamily`);
  if (
    entry.idempotencyPolicy.kind !== "required" ||
    entry.idempotencyPolicy.keyField !== "idempotency_key" ||
    entry.idempotencyPolicy.conflictOnArgumentsHashMismatch !== true
  ) {
    throw new TypeError(`${entry.name} requires exact idempotency policy`);
  }

  if (
    entry.operation === "prepare" &&
    entry.confirmationPolicy.kind !== "change_set_preview"
  ) {
    throw new TypeError(`${entry.name} must create an exact preview`);
  }
  if (
    entry.operation === "commit" &&
    entry.confirmationPolicy.kind !== "confirmation_receipt"
  ) {
    throw new TypeError(`${entry.name} must require confirmation`);
  }
}

export function assertCapabilityManifestInvariants(
  entries: readonly CapabilityManifestEntry[],
  rawManifestRevision: string
): void {
  const manifestRevision = requiredNonBlank(
    rawManifestRevision,
    "capabilityManifestRevision"
  );
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError("capability manifest must not be empty");
  }

  const byName = new Map<string, CapabilityManifestEntry>();
  const rolloutFlags = new Set<string>();
  for (const entry of entries) {
    const name = requiredNonBlank(entry.name, "capability.name");
    if (
      !CAPABILITY_NAME_PATTERN.test(name) ||
      GENERIC_CAPABILITY_PATTERNS.some((pattern) => pattern.test(name)) ||
      PROHIBITED_DOMAIN_CAPABILITY_PATTERNS.some((pattern) =>
        pattern.test(name)
      )
    ) {
      throw new TypeError(`${name} is not a permitted capability name`);
    }
    if (byName.has(name)) {
      throw new TypeError(`${name} is duplicated`);
    }
    byName.set(name, entry);

    requiredNonBlank(entry.schemaRevision, `${name}.schemaRevision`);
    requiredNonBlank(entry.description, `${name}.description`);
    if (
      typeof entry.inputSchema !== "object" ||
      entry.inputSchema === null ||
      typeof entry.inputSchema.safeParse !== "function" ||
      !("_zod" in entry.inputSchema)
    ) {
      throw new TypeError(`${name} must use a zod-v4 input schema`);
    }
    if (!(["read", "prepare", "commit"] as const).includes(entry.operation)) {
      throw new TypeError(`${name} operation is invalid`);
    }
    if (
      !(["low", "medium", "high", "critical"] as const).includes(entry.riskTier)
    ) {
      throw new TypeError(`${name} risk tier is invalid`);
    }

    requiredPositiveInteger(
      entry.bounds.maxInputBytes,
      `${name}.maxInputBytes`
    );
    requiredPositiveInteger(
      entry.bounds.maxOutputCharacters,
      `${name}.maxOutputCharacters`
    );
    requiredPositiveInteger(
      entry.bounds.maxResultItems,
      `${name}.maxResultItems`
    );
    if (entry.bounds.maxWindowDays !== undefined) {
      requiredPositiveInteger(
        entry.bounds.maxWindowDays,
        `${name}.maxWindowDays`
      );
    }
    if (entry.bounds.maxBatchItems !== undefined) {
      requiredPositiveInteger(
        entry.bounds.maxBatchItems,
        `${name}.maxBatchItems`
      );
    }

    if (
      entry.evidencePolicy.promptSafeOutput !== true ||
      entry.evidencePolicy.output !== "required" ||
      entry.evidencePolicy.untrustedExternalContent !== "structured_and_marked"
    ) {
      throw new TypeError(`${name} evidence policy is unsafe`);
    }
    requiredPositiveInteger(
      entry.evidencePolicy.maxEvidenceRefs,
      `${name}.maxEvidenceRefs`
    );
    requiredNonBlank(entry.auditClass, `${name}.auditClass`);
    requiredNonBlank(entry.rateLimitBucket, `${name}.rateLimitBucket`);
    if (
      entry.annotations.openWorldHint !==
      (entry.auditClass === "external_commit")
    ) {
      throw new TypeError(`${name} open-world annotation is invalid`);
    }

    const rolloutFlag = requiredNonBlank(
      entry.rolloutFlag,
      `${name}.rolloutFlag`
    );
    if (rolloutFlags.has(rolloutFlag)) {
      throw new TypeError(`${name} rollout flag is duplicated`);
    }
    rolloutFlags.add(rolloutFlag);
    if (
      entry.availability.externalExposure === "enabled" &&
      entry.availability.implementation !== "available"
    ) {
      throw new TypeError(
        `${name} cannot expose an unavailable implementation`
      );
    }

    assertAnnotations(entry);
    assertAuthorization(entry, manifestRevision);
    assertConfirmation(entry);
  }

  for (const entry of entries) {
    if (entry.operation !== "commit") continue;
    if (entry.confirmationPolicy.kind !== "confirmation_receipt") {
      throw new TypeError(`${entry.name} commit confirmation is invalid`);
    }
    const prepare = byName.get(entry.confirmationPolicy.prepareCapability);
    if (
      !prepare ||
      prepare.operation !== "prepare" ||
      prepare.writeFamily !== entry.writeFamily
    ) {
      throw new TypeError(`${entry.name} has no matching prepare capability`);
    }
  }

  for (const entry of entries) {
    if (entry.operation !== "prepare") continue;
    const commits = entries.filter(
      (candidate) =>
        candidate.operation === "commit" &&
        candidate.writeFamily === entry.writeFamily
    );
    if (commits.length !== 1) {
      throw new TypeError(`${entry.name} must have exactly one commit sibling`);
    }
  }
}
