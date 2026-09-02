import type { z } from "zod-v4";

import {
  isManifestCapabilityPolicy,
  type CapabilityPermissionRequirement,
  type ManifestCapabilityPolicy,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import { REGISTERED_MCP_SCOPES } from "@/lib/agent-control-plane/registry/mcp-scope-catalog";
/*
 * This is deliberately not an open string registry. Adding a scope changes
 * the external consent surface and must ship as a reviewed manifest revision.
 */
export const CAPABILITY_OAUTH_SCOPES = REGISTERED_MCP_SCOPES;

const CAPABILITY_OAUTH_SCOPE_SET = new Set<string>(CAPABILITY_OAUTH_SCOPES);

export type CapabilityOperation = "read" | "prepare" | "commit";
export type CapabilityRiskTier = "low" | "medium" | "high" | "critical";
export type CapabilityImplementationAvailability = "unavailable" | "available";
export type CapabilityExternalExposure = "disabled" | "enabled";
export interface CapabilityImplementationState {
  readonly implementation: CapabilityImplementationAvailability;
}
export type CapabilityAuditClass =
  | "operational_read"
  | "sensitive_read"
  | "evidence_read"
  | "search_read"
  | "mutation_prepare"
  | "mutation_commit"
  | "external_commit";
export type CapabilityRateLimitBucket =
  | "lightweight_read"
  | "evidence_search"
  | "prepare"
  | "commit";

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
    | "not_required"
    | "optional"
    | "required"
    | "prepared_change_set";
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
  | Readonly<{ kind: "input_always" }>
  | Readonly<{
      kind: "customer_discovery_lookup";
      lookup: "name" | "exact_contact";
    }>
  | Readonly<{
      kind: "job_discovery_kind";
      jobKind: "opportunity" | "project";
    }>
  | Readonly<{
      kind: "customer_job_kind";
      jobKind: "opportunity" | "project";
    }>
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
      kind: "job_participant_purpose";
      jobKind: "opportunity" | "project";
      purpose: "schedule" | "assignment";
    }>
  | Readonly<{
      kind: "job_summary_readiness";
      authority: "site_photos" | "customer" | "schedule";
    }>
  | Readonly<{
      kind: "job_summary_financial_component";
      jobKind: "opportunity" | "project";
      component: "estimate_rollup" | "invoice_rollup";
    }>
  | Readonly<{
      kind: "job_history_scope";
      scopeKind: "customer";
    }>
  | Readonly<{
      kind: "job_history_job_kind";
      jobKind: "opportunity" | "project";
    }>
  | Readonly<{
      kind: "job_history_source_authority";
      authority: "correspondence" | "task_event";
    }>
  | Readonly<{
      kind: "job_history_financial_source";
      jobKind: "opportunity" | "project";
    }>
  | Readonly<{
      kind: "input_value";
      field: "anchor" | "include_unlinked" | "mode" | "source" | "view";
      value:
        | true
        | "booked_appointments"
        | "company"
        | "edit"
        | "import"
        | "opportunity"
        | "self"
        | "site_visit_artifact"
        | "unlinked"
        | "visit_history";
    }>
  | Readonly<{
      kind: "input_array_contains";
      field: "document_kinds" | "job_kinds" | "rule_codes" | "sections";
      value:
        | "CUSTOMER_RECORD_UNRESOLVED"
        | "SITE_PHOTOS_MISSING"
        | "contacts"
        | "costs"
        | "estimate"
        | "financial_origin"
        | "invoice"
        | "opportunity"
        | "project"
        | "schedule"
        | "supplier_costs";
    }>
  | Readonly<{
      kind: "input_object_discriminator";
      field: "document_ref" | "expense_ref" | "job_ref" | "view";
      discriminator: "kind";
      value:
        | "company"
        | "estimate"
        | "expense"
        | "invoice"
        | "job"
        | "mine"
        | "opportunity"
        | "pending_approval"
        | "project"
        | "reimbursement_batches"
        | "schedule_window";
    }>
  | Readonly<{
      kind: "input_array_object_discriminator";
      field: "integrations";
      discriminator: "integration_type";
      value: "accounting" | "mailbox";
    }>
  | Readonly<{
      kind: "input_source_kind";
      value:
        | "deck_design"
        | "email_attachment"
        | "expense_receipt"
        | "generated_estimate"
        | "generated_invoice"
        | "project_photo"
        | "site_visit_artifact";
    }>
  | Readonly<{
      kind: "input_source_and_job_kind";
      sourceKind: "project_note";
      jobKind: "opportunity" | "project";
    }>
  | Readonly<{
      kind: "input_source_and_job_kind";
      source: "job_artifact";
      jobKind: "opportunity" | "project";
    }>
  | Readonly<{
      kind: "site_visit_context_artifact_sections";
      anchor: "opportunity" | "unlinked";
      field: "sections";
      values: readonly ("artifact_summary" | "deck_design_refs")[];
    }>
  | Readonly<{
      kind: "operational_overview_component";
      field: "components";
      value:
        | "financial_attention"
        | "integration_attention"
        | "schedule_readiness"
        | "stock_attention"
        | "unresolved_correspondence"
        | "work_due";
      defaultWhenOmitted: true;
    }>
  | Readonly<{
      kind: "work_queue_source";
      field: "sources";
      value:
        | "commitment"
        | "correspondence"
        | "expense"
        | "financial_document"
        | "lead"
        | "match_review"
        | "payment"
        | "schedule"
        | "task";
      defaultWhenOmitted: true;
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
  readonly availability: CapabilityImplementationState;
  readonly rolloutFlag: string;
}

export interface CapabilityDefinition extends CapabilityBase {
  readonly authorization: CapabilityAuthorizationDefinition;
  readonly availability: Readonly<{
    implementation: CapabilityImplementationAvailability;
    externalExposure: CapabilityExternalExposure;
  }>;
}

/** Frozen v7 definition shape retained only for byte-compatible manifests. */
export type LegacyCapabilityDefinition = CapabilityDefinition;

/**
 * V8 candidates carry implementation truth only. External rollout belongs to
 * the separately versioned MCP exposure catalogue, never to policy bytes.
 */
export type ImplementationOnlyCapabilityDefinition = Omit<
  CapabilityDefinition,
  "availability"
> &
  Readonly<{ availability: CapabilityImplementationState }>;

export interface CapabilityManifestEntry extends CapabilityBase {
  readonly authorization: CapabilityAuthorizationManifest;
}

/** Exact frozen v7 entry shape, retained only for compatibility proof. */
export type LegacyCapabilityManifestEntry = Omit<
  CapabilityManifestEntry,
  "availability"
> &
  Readonly<{ availability: CapabilityDefinition["availability"] }>;

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

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
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
    if (!isExactAuthorizationSelector(variant.selector)) {
      throw new TypeError(`${entry.name}.${key} has an invalid selector`);
    }
    if (
      (variant.selector.kind === "job_purpose" &&
        entry.name !== "get_job_communication_context") ||
      (variant.selector.kind === "job_participant_purpose" &&
        entry.name !== "resolve_job_participants") ||
      (variant.selector.kind === "customer_job_kind" &&
        entry.name !== "list_customer_jobs") ||
      (variant.selector.kind === "customer_discovery_lookup" &&
        entry.name !== "search_customers") ||
      (variant.selector.kind === "job_discovery_kind" &&
        entry.name !== "search_jobs") ||
      ((variant.selector.kind === "job_summary_readiness" ||
        variant.selector.kind === "job_summary_financial_component") &&
        entry.name !== "get_job_summary") ||
      ((variant.selector.kind === "job_history_scope" ||
        variant.selector.kind === "job_history_job_kind" ||
        variant.selector.kind === "job_history_source_authority" ||
        variant.selector.kind === "job_history_financial_source") &&
        entry.name !== "search_job_history") ||
      (variant.selector.kind === "input_always" &&
        entry.name !== "list_payments") ||
      ((variant.selector.kind === "input_source_kind" ||
        (variant.selector.kind === "input_source_and_job_kind" &&
          "sourceKind" in variant.selector)) &&
        entry.name !== "list_job_artifacts" &&
        entry.name !== "get_job_artifact_evidence") ||
      (variant.selector.kind === "input_source_and_job_kind" &&
        "source" in variant.selector &&
        entry.name !== "get_deck_design_geometry") ||
      (variant.selector.kind === "site_visit_context_artifact_sections" &&
        entry.name !== "get_site_visit_context") ||
      (variant.selector.kind === "input_array_object_discriminator" &&
        entry.name !== "get_integration_health") ||
      (variant.selector.kind === "operational_overview_component" &&
        entry.name !== "get_operational_overview") ||
      (variant.selector.kind === "work_queue_source" &&
        entry.name !== "list_work_queue")
    ) {
      throw new TypeError(
        `${entry.name}.${key} selector is not valid for this capability`
      );
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

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isExactAuthorizationSelector(
  value: unknown
): value is CapabilityAuthorizationSelector {
  if (typeof value !== "object" || value === null) return false;
  const selector = value as Record<string, unknown>;
  switch (selector.kind) {
    case "always":
    case "input_always":
      return hasExactKeys(selector, ["kind"]);
    case "customer_discovery_lookup":
      return (
        hasExactKeys(selector, ["kind", "lookup"]) &&
        (selector.lookup === "name" || selector.lookup === "exact_contact")
      );
    case "job_kind":
      return (
        hasExactKeys(selector, ["kind", "jobKind"]) &&
        (selector.jobKind === "opportunity" || selector.jobKind === "project")
      );
    case "job_discovery_kind":
    case "customer_job_kind":
    case "job_history_job_kind":
      return (
        hasExactKeys(selector, ["kind", "jobKind"]) &&
        (selector.jobKind === "opportunity" || selector.jobKind === "project")
      );
    case "job_section":
      return (
        hasExactKeys(selector, ["kind", "jobKind", "section"]) &&
        (selector.jobKind === "opportunity" ||
          selector.jobKind === "project") &&
        [
          "schedule",
          "readiness",
          "participants",
          "financials",
          "activity",
          "conversation",
        ].includes(selector.section as string)
      );
    case "job_purpose":
      return (
        hasExactKeys(selector, ["kind", "jobKind", "purpose"]) &&
        (selector.jobKind === "opportunity" ||
          selector.jobKind === "project") &&
        ["schedule_notice", "photo_request", "general"].includes(
          selector.purpose as string
        )
      );
    case "job_participant_purpose":
      return (
        hasExactKeys(selector, ["kind", "jobKind", "purpose"]) &&
        (selector.jobKind === "opportunity" ||
          selector.jobKind === "project") &&
        ["schedule", "assignment"].includes(selector.purpose as string)
      );
    case "job_summary_readiness":
      return (
        hasExactKeys(selector, ["kind", "authority"]) &&
        ["site_photos", "customer", "schedule"].includes(
          selector.authority as string
        )
      );
    case "job_summary_financial_component":
      return (
        hasExactKeys(selector, ["kind", "jobKind", "component"]) &&
        (selector.jobKind === "opportunity" ||
          selector.jobKind === "project") &&
        ["estimate_rollup", "invoice_rollup"].includes(
          selector.component as string
        )
      );
    case "job_history_scope":
      return (
        hasExactKeys(selector, ["kind", "scopeKind"]) &&
        selector.scopeKind === "customer"
      );
    case "job_history_source_authority":
      return (
        hasExactKeys(selector, ["kind", "authority"]) &&
        ["correspondence", "task_event"].includes(selector.authority as string)
      );
    case "job_history_financial_source":
      return (
        hasExactKeys(selector, ["kind", "jobKind"]) &&
        (selector.jobKind === "opportunity" || selector.jobKind === "project")
      );
    case "input_value": {
      if (!hasExactKeys(selector, ["kind", "field", "value"])) return false;
      const allowed: Readonly<Record<string, readonly unknown[]>> = {
        anchor: ["opportunity", "unlinked"],
        include_unlinked: [true],
        mode: ["import", "edit"],
        source: ["site_visit_artifact"],
        view: ["booked_appointments", "company", "self", "visit_history"],
      };
      return (
        typeof selector.field === "string" &&
        allowed[selector.field]?.includes(selector.value) === true
      );
    }
    case "input_array_contains": {
      if (!hasExactKeys(selector, ["kind", "field", "value"])) return false;
      const allowed: Readonly<Record<string, readonly unknown[]>> = {
        document_kinds: ["estimate", "invoice"],
        job_kinds: ["opportunity", "project"],
        rule_codes: ["CUSTOMER_RECORD_UNRESOLVED", "SITE_PHOTOS_MISSING"],
        sections: [
          "contacts",
          "costs",
          "financial_origin",
          "schedule",
          "supplier_costs",
        ],
      };
      return (
        typeof selector.field === "string" &&
        allowed[selector.field]?.includes(selector.value) === true
      );
    }
    case "input_object_discriminator": {
      if (
        !hasExactKeys(selector, ["kind", "field", "discriminator", "value"]) ||
        selector.discriminator !== "kind"
      ) {
        return false;
      }
      const allowed: Readonly<Record<string, readonly unknown[]>> = {
        document_ref: ["estimate", "invoice"],
        expense_ref: ["expense"],
        job_ref: ["opportunity", "project"],
        view: [
          "company",
          "job",
          "mine",
          "pending_approval",
          "reimbursement_batches",
          "schedule_window",
        ],
      };
      return (
        typeof selector.field === "string" &&
        allowed[selector.field]?.includes(selector.value) === true
      );
    }
    case "input_array_object_discriminator":
      return (
        hasExactKeys(selector, ["kind", "field", "discriminator", "value"]) &&
        selector.field === "integrations" &&
        selector.discriminator === "integration_type" &&
        (selector.value === "accounting" || selector.value === "mailbox")
      );
    case "input_source_kind":
      return (
        hasExactKeys(selector, ["kind", "value"]) &&
        [
          "deck_design",
          "email_attachment",
          "expense_receipt",
          "generated_estimate",
          "generated_invoice",
          "project_photo",
          "site_visit_artifact",
        ].includes(selector.value as string)
      );
    case "input_source_and_job_kind":
      if (
        selector.jobKind !== "opportunity" &&
        selector.jobKind !== "project"
      ) {
        return false;
      }
      if (hasExactKeys(selector, ["kind", "jobKind", "sourceKind"])) {
        return selector.sourceKind === "project_note";
      }
      return (
        hasExactKeys(selector, ["kind", "jobKind", "source"]) &&
        selector.source === "job_artifact"
      );
    case "site_visit_context_artifact_sections":
      return (
        hasExactKeys(selector, ["anchor", "field", "kind", "values"]) &&
        (selector.anchor === "opportunity" || selector.anchor === "unlinked") &&
        selector.field === "sections" &&
        Array.isArray(selector.values) &&
        selector.values.length === 1 &&
        (selector.values[0] === "artifact_summary" ||
          selector.values[0] === "deck_design_refs")
      );
    case "operational_overview_component":
      return (
        hasExactKeys(selector, [
          "defaultWhenOmitted",
          "field",
          "kind",
          "value",
        ]) &&
        selector.defaultWhenOmitted === true &&
        selector.field === "components" &&
        [
          "financial_attention",
          "integration_attention",
          "schedule_readiness",
          "stock_attention",
          "unresolved_correspondence",
          "work_due",
        ].includes(selector.value as string)
      );
    case "work_queue_source":
      return (
        hasExactKeys(selector, [
          "defaultWhenOmitted",
          "field",
          "kind",
          "value",
        ]) &&
        selector.defaultWhenOmitted === true &&
        selector.field === "sources" &&
        [
          "commitment",
          "correspondence",
          "expense",
          "financial_document",
          "lead",
          "match_review",
          "payment",
          "schedule",
          "task",
        ].includes(selector.value as string)
      );
    default:
      return false;
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
  const exactDurableIdempotency =
    entry.idempotencyPolicy.kind === "required" &&
    entry.idempotencyPolicy.keyField === "idempotency_key" &&
    entry.idempotencyPolicy.conflictOnArgumentsHashMismatch === true;
  const inherentEphemeralPreview =
    entry.operation === "prepare" &&
    entry.confirmationPolicy.kind === "change_set_preview" &&
    entry.idempotencyPolicy.kind === "inherent" &&
    entry.annotations.idempotentHint === true;
  if (!exactDurableIdempotency && !inherentEphemeralPreview) {
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
    requiredNonNegativeInteger(
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
      "externalExposure" in entry.availability &&
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
    const expectedCommitSiblings =
      entry.idempotencyPolicy.kind === "inherent" ? 0 : 1;
    if (commits.length !== expectedCommitSiblings) {
      throw new TypeError(
        expectedCommitSiblings === 0
          ? `${entry.name} ephemeral preview cannot have a commit sibling`
          : `${entry.name} must have exactly one commit sibling`
      );
    }
  }
}
