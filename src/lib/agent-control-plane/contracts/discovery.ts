import { z } from "zod-v4";

import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";

import {
  CursorPageSchema,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
} from "./common";
import { createAgentResultSchema } from "./evidence";
import {
  CurrentJobDateWindowSchema,
  CurrentJobRefSchema,
  CustomerJobSchema,
  CustomerRefSchema,
  JOB_CATALOG_PROMPT_SAFETY_DIRECTIVE,
  JobKindSchema,
  NormalizedJobLifecycleStateSchema,
  OpportunityStageSchema,
  ProjectStatusSchema,
} from "./job-catalog";
import { discoveryTextUsesUnicode15 } from "./discovery-unicode15";

export const DISCOVERY_CAPABILITY_SCHEMA_REVISION = "2026-08-20.v1" as const;
export const CUSTOMER_DISCOVERY_RANKING_REVISION =
  "customer-discovery-ranking:v1" as const;
export const JOB_DISCOVERY_RANKING_REVISION =
  "job-discovery-ranking:v1" as const;
export const MAX_DISCOVERY_MATCHES = 25;
export const MAX_DISCOVERY_OUTPUT_CHARACTERS = 60_000;
export const DISCOVERY_PROMPT_SAFETY_DIRECTIVE =
  JOB_CATALOG_PROMPT_SAFETY_DIRECTIVE;
export const DISCOVERY_RESULT_BUDGET_WARNING = Object.freeze({
  code: "RESULT_BUDGET_EXCEEDED",
  message:
    "Some matches were omitted to keep this result within 60,000 characters.",
} as const);

export function discoveryPromptSerializedLength(value: unknown): number {
  return serializeUntrustedPromptData(value).length;
}

const DEFAULT_DISCOVERY_LIMIT = 10;
const MAX_DISCOVERY_QUERY_SCALARS = 200;
const MAX_DISCOVERY_QUERY_TOKENS = 8;
const MIN_DISCOVERY_TOKEN_SCALARS = 2;
const MAX_DISCOVERY_TOKEN_SCALARS = 64;
const FORBIDDEN_CONTROL_OR_BIDI_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const SIGNED_DISCOVERY_CURSOR_PATTERN =
  /^ops_cursor:v[1-9][0-9]*:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

const UTF8_ENCODER = new TextEncoder();

function safeReturnedBusinessStringSchema(
  maximumCharacters: number,
  maximumUtf8Bytes: number
) {
  return z
    .string()
    .min(1)
    .max(maximumCharacters)
    .superRefine((value, context) => {
      if (
        value.trim() !== value ||
        FORBIDDEN_CONTROL_OR_BIDI_PATTERN.test(value) ||
        hasUnpairedSurrogate(value) ||
        !discoveryTextUsesUnicode15(value) ||
        UTF8_ENCODER.encode(value).length > maximumUtf8Bytes
      ) {
        context.addIssue({
          code: "custom",
          message: "Returned business text is unsafe or exceeds its byte bound",
        });
      }
    });
}

function normalizeDiscoveryText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

const SafeRawDiscoveryTextSchema = z.string().superRefine((value, context) => {
  if (
    FORBIDDEN_CONTROL_OR_BIDI_PATTERN.test(value) ||
    hasUnpairedSurrogate(value) ||
    !discoveryTextUsesUnicode15(value)
  ) {
    context.addIssue({
      code: "custom",
      message: "Discovery text contains unsafe Unicode controls",
    });
  }
});

export const DiscoveryTextQuerySchema = SafeRawDiscoveryTextSchema.transform(
  normalizeDiscoveryText
).pipe(
  z.string().superRefine((value, context) => {
    const length = scalarLength(value);
    if (length < 2 || length > MAX_DISCOVERY_QUERY_SCALARS) {
      context.addIssue({
        code: "custom",
        message: "Discovery text must contain 2 to 200 Unicode scalars",
      });
    }
    const tokens = value.length === 0 ? [] : value.split(" ");
    if (tokens.length > MAX_DISCOVERY_QUERY_TOKENS) {
      context.addIssue({
        code: "custom",
        message: "Discovery text cannot exceed eight tokens",
      });
    }
    if (
      tokens.some((token) => {
        const length = scalarLength(token);
        return (
          length < MIN_DISCOVERY_TOKEN_SCALARS ||
          length > MAX_DISCOVERY_TOKEN_SCALARS
        );
      })
    ) {
      context.addIssue({
        code: "custom",
        message: "Discovery text tokens require 2 to 64 Unicode scalars",
      });
    }
  })
);

const EXACT_DISCOVERY_EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ExactEmailQuerySchema = SafeRawDiscoveryTextSchema.transform(
  normalizeDiscoveryText
).superRefine((value, context) => {
  const length = scalarLength(value);
  const localPartLength = value.indexOf("@");
  if (
    length < 3 ||
    length > MAX_DISCOVERY_QUERY_SCALARS ||
    localPartLength < 1 ||
    localPartLength > 64 ||
    !EXACT_DISCOVERY_EMAIL_PATTERN.test(value)
  ) {
    context.addIssue({
      code: "custom",
      message: "Email lookup requires an exact normalized address",
    });
  }
});

function normalizedNanpPhone(value: string): string | null {
  if (!/^[+0-9(). -]+$/u.test(value)) return null;
  const compact = value.replace(/[(). -]/gu, "");
  const national = compact.startsWith("+1")
    ? compact.slice(2)
    : compact.length === 10 && !compact.startsWith("+")
      ? compact
      : null;
  if (national === null || !/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(national)) {
    return null;
  }
  return `+1${national}`;
}

const ExactPhoneQuerySchema = SafeRawDiscoveryTextSchema.transform(
  normalizeDiscoveryText
).transform((value, context) => {
  const length = scalarLength(value);
  if (length < 2 || length > MAX_DISCOVERY_QUERY_SCALARS) {
    context.addIssue({
      code: "custom",
      message: "Phone lookup exceeds the discovery query bound",
    });
    return z.NEVER;
  }
  const normalized = normalizedNanpPhone(value);
  if (normalized === null) {
    context.addIssue({
      code: "custom",
      message: "Phone lookup requires an exact NANP number",
    });
    return z.NEVER;
  }
  return normalized;
});

const SignedDiscoveryCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(SIGNED_DISCOVERY_CURSOR_PATTERN);
const SignedDiscoveryCursorPageSchema = CursorPageSchema.safeExtend({
  next_cursor: SignedDiscoveryCursorSchema.nullable(),
});

function uniqueEnumArray<TSchema extends z.ZodEnum>(
  schema: TSchema,
  maximum: number,
  message: string
) {
  return z
    .array(schema)
    .min(1)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, message);
}

const CustomerKindSchema = z.enum(["client", "sub_client"]);
const CustomerKindsSchema = uniqueEnumArray(
  CustomerKindSchema,
  2,
  "Customer kinds must be unique"
);
const CustomerDiscoveryInputPageShape = {
  customer_kinds: CustomerKindsSchema.default(["client", "sub_client"]),
  cursor: SignedDiscoveryCursorSchema.optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_DISCOVERY_MATCHES)
    .default(DEFAULT_DISCOVERY_LIMIT),
};

export const CustomerDiscoveryLookupSchema = z.enum([
  "name",
  "exact_email",
  "exact_phone",
]);

export const SearchCustomersInputSchema = z.discriminatedUnion("lookup", [
  z
    .object({
      lookup: z.literal("name"),
      query: DiscoveryTextQuerySchema,
      ...CustomerDiscoveryInputPageShape,
    })
    .strict(),
  z
    .object({
      lookup: z.literal("exact_email"),
      query: ExactEmailQuerySchema,
      ...CustomerDiscoveryInputPageShape,
    })
    .strict(),
  z
    .object({
      lookup: z.literal("exact_phone"),
      query: ExactPhoneQuerySchema,
      ...CustomerDiscoveryInputPageShape,
    })
    .strict(),
]);

const QueryFieldSchema = z.enum(["title", "address"]);
const QueryFieldsSchema = uniqueEnumArray(
  QueryFieldSchema,
  2,
  "Query fields must be unique"
);
const JobKindsSchema = uniqueEnumArray(
  JobKindSchema,
  2,
  "Job kinds must be unique"
);
const LifecycleStatesSchema = uniqueEnumArray(
  NormalizedJobLifecycleStateSchema,
  3,
  "Lifecycle states must be unique"
);
const OpportunityStagesSchema = uniqueEnumArray(
  OpportunityStageSchema,
  OpportunityStageSchema.options.length,
  "Opportunity stages must be unique"
);
const ProjectStatusesSchema = uniqueEnumArray(
  ProjectStatusSchema,
  ProjectStatusSchema.options.length,
  "Project statuses must be unique"
);

function opportunityStageCanMatchLifecycle(
  stage: z.infer<typeof OpportunityStageSchema>,
  lifecycle: z.infer<typeof NormalizedJobLifecycleStateSchema>
): boolean {
  if (stage === "discarded") return lifecycle === "archived";
  if (stage === "won" || stage === "lost") {
    return lifecycle === "terminal" || lifecycle === "archived";
  }
  return lifecycle === "active" || lifecycle === "archived";
}

function projectStatusCanMatchLifecycle(
  status: z.infer<typeof ProjectStatusSchema>,
  lifecycle: z.infer<typeof NormalizedJobLifecycleStateSchema>
): boolean {
  if (status === "archived") return lifecycle === "archived";
  if (status === "completed" || status === "closed") {
    return lifecycle === "terminal";
  }
  return lifecycle === "active";
}
export const DiscoveryMillisecondUtcTimestampSchema = z
  .string()
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(Rfc3339UtcTimestampSchema);
const DiscoveryJobDateWindowSchema = CurrentJobDateWindowSchema.safeExtend({
  field: z.enum(["created_at", "updated_at"]),
  from: DiscoveryMillisecondUtcTimestampSchema,
  to_exclusive: DiscoveryMillisecondUtcTimestampSchema,
}).strict();

const SearchJobsInputBaseSchema = z
  .object({
    query: DiscoveryTextQuerySchema.optional(),
    query_fields: QueryFieldsSchema.optional(),
    job_kinds: JobKindsSchema.default(["opportunity", "project"]),
    lifecycle_states: LifecycleStatesSchema.optional(),
    opportunity_stages: OpportunityStagesSchema.optional(),
    project_statuses: ProjectStatusesSchema.optional(),
    date_window: DiscoveryJobDateWindowSchema.optional(),
    cursor: SignedDiscoveryCursorSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_DISCOVERY_MATCHES)
      .default(DEFAULT_DISCOVERY_LIMIT),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.query === undefined &&
      input.lifecycle_states === undefined &&
      input.opportunity_stages === undefined &&
      input.project_statuses === undefined &&
      input.date_window === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["query"],
        message:
          "Job discovery requires a query, status filter, or date window",
      });
    }
    if (input.query === undefined && input.query_fields !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["query_fields"],
        message: "Query fields require discovery text",
      });
    }
    if (
      input.opportunity_stages !== undefined &&
      !input.job_kinds.includes("opportunity")
    ) {
      context.addIssue({
        code: "custom",
        path: ["opportunity_stages"],
        message: "Opportunity stages require opportunity jobs",
      });
    }
    if (
      input.project_statuses !== undefined &&
      !input.job_kinds.includes("project")
    ) {
      context.addIssue({
        code: "custom",
        path: ["project_statuses"],
        message: "Project statuses require project jobs",
      });
    }
    if (input.lifecycle_states !== undefined) {
      const opportunityCanMatch =
        input.job_kinds.includes("opportunity") &&
        (input.opportunity_stages === undefined ||
          input.opportunity_stages.some((stage) =>
            input.lifecycle_states!.some((lifecycle) =>
              opportunityStageCanMatchLifecycle(stage, lifecycle)
            )
          ));
      const projectCanMatch =
        input.job_kinds.includes("project") &&
        (input.project_statuses === undefined ||
          input.project_statuses.some((status) =>
            input.lifecycle_states!.some((lifecycle) =>
              projectStatusCanMatchLifecycle(status, lifecycle)
            )
          ));
      if (!opportunityCanMatch && !projectCanMatch) {
        context.addIssue({
          code: "custom",
          path: ["lifecycle_states"],
          message:
            "Lifecycle and status filters cannot match any selected job kind",
        });
      }
    }
  });

export const SearchJobsInputSchema = SearchJobsInputBaseSchema.transform(
  (input) =>
    input.query === undefined
      ? input
      : {
          ...input,
          query_fields: input.query_fields ?? ["title", "address"],
        }
);

const CustomerMatchBasisSchema = z
  .object({
    ranking_revision: z.literal(CUSTOMER_DISCOVERY_RANKING_REVISION),
    kind: z.enum([
      "exact_name",
      "prefix_name",
      "all_tokens_name",
      "exact_email",
      "exact_phone",
    ]),
  })
  .strict();
const CustomerMatchSharedShape = {
  display_name: safeReturnedBusinessStringSchema(1_000, 1_000),
  match_basis: CustomerMatchBasisSchema,
  content_kind: z.literal("untrusted_business_data"),
  visibility_reason: z.literal("current_actor_authorized"),
  evidence_ids: z.array(OpaqueIdSchema).length(1),
};

const ClientCustomerRefSchema = CustomerRefSchema.options[0];
const SubClientCustomerRefSchema = CustomerRefSchema.options[1];

export const CustomerDiscoveryMatchSchema = z
  .union([
    z
      .object({
        customer_ref: ClientCustomerRefSchema,
        display_name: CustomerMatchSharedShape.display_name,
        relationship: z.object({ kind: z.literal("primary_client") }).strict(),
        match_basis: CustomerMatchSharedShape.match_basis,
        content_kind: CustomerMatchSharedShape.content_kind,
        visibility_reason: CustomerMatchSharedShape.visibility_reason,
        evidence_ids: CustomerMatchSharedShape.evidence_ids,
      })
      .strict(),
    z
      .object({
        customer_ref: SubClientCustomerRefSchema,
        display_name: CustomerMatchSharedShape.display_name,
        relationship: z
          .object({
            kind: z.literal("sub_client"),
            parent_client_ref: ClientCustomerRefSchema,
            parent_display_name: safeReturnedBusinessStringSchema(1_000, 1_000),
          })
          .strict(),
        match_basis: CustomerMatchSharedShape.match_basis,
        content_kind: CustomerMatchSharedShape.content_kind,
        visibility_reason: CustomerMatchSharedShape.visibility_reason,
        evidence_ids: CustomerMatchSharedShape.evidence_ids,
      })
      .strict(),
  ])
  .superRefine((match, context) => {
    const ids = [
      match.customer_ref.id,
      ...(match.relationship.kind === "sub_client"
        ? [match.relationship.parent_client_ref.id]
        : []),
    ];
    if (ids.some((id) => !isCanonicalLowercaseUuid(id))) {
      context.addIssue({
        code: "custom",
        path: ["customer_ref"],
        message: "Discovery UUID identities must use canonical lowercase text",
      });
    }
  });

const JobStatusSchema = CustomerJobSchema.shape.status;
const JobDatesSchema = z.discriminatedUnion("kind", [
  CustomerJobSchema.shape.dates.options[0]
    .safeExtend({
      created_at: DiscoveryMillisecondUtcTimestampSchema,
      updated_at: DiscoveryMillisecondUtcTimestampSchema,
    })
    .strict(),
  CustomerJobSchema.shape.dates.options[1]
    .safeExtend({
      created_at: DiscoveryMillisecondUtcTimestampSchema,
      updated_at: DiscoveryMillisecondUtcTimestampSchema,
    })
    .strict(),
]);
const JobConversionSchema = CustomerJobSchema.shape.conversion;

const JobDiscoveryMatchBasisSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ranking_revision: z.literal(JOB_DISCOVERY_RANKING_REVISION),
      kind: z.literal("filter_only"),
      field: z.literal("none"),
    })
    .strict(),
  z
    .object({
      ranking_revision: z.literal(JOB_DISCOVERY_RANKING_REVISION),
      kind: z.enum(["exact_title", "prefix_title", "all_tokens_title"]),
      field: z.literal("title"),
    })
    .strict(),
  z
    .object({
      ranking_revision: z.literal(JOB_DISCOVERY_RANKING_REVISION),
      kind: z.enum(["exact_address", "prefix_address", "all_tokens_address"]),
      field: z.literal("address"),
    })
    .strict(),
]);

function referenceIdentity(reference: {
  readonly kind: "opportunity" | "project";
  readonly id: string;
}): string {
  return `${reference.kind}:${reference.id}`;
}

function valuesAreUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isCanonicalLowercaseUuid(value: string): boolean {
  return value === value.toLowerCase();
}

function lifecycleMatchesStatus(input: {
  readonly lifecycle_state: z.infer<typeof NormalizedJobLifecycleStateSchema>;
  readonly status: z.infer<typeof JobStatusSchema>;
}): boolean {
  if (
    input.status.kind === "opportunity" &&
    input.status.value === "discarded"
  ) {
    return input.lifecycle_state === "archived";
  }
  if (input.lifecycle_state === "archived") {
    return (
      (input.status.kind === "project" && input.status.value === "archived") ||
      input.status.kind === "opportunity"
    );
  }
  const terminal =
    input.status.kind === "opportunity"
      ? ["won", "lost"].includes(input.status.value)
      : ["completed", "closed"].includes(input.status.value);
  return input.lifecycle_state === (terminal ? "terminal" : "active");
}

export const JobDiscoveryMatchSchema = z
  .object({
    job_ref: CurrentJobRefSchema,
    anchor_refs: z.array(CurrentJobRefSchema).min(1).max(2),
    display_title: safeReturnedBusinessStringSchema(1_000, 1_000),
    address: safeReturnedBusinessStringSchema(2_000, 2_000).nullable(),
    lifecycle_state: NormalizedJobLifecycleStateSchema,
    status: JobStatusSchema,
    dates: JobDatesSchema,
    conversion: JobConversionSchema,
    match_basis: JobDiscoveryMatchBasisSchema,
    content_kind: z.literal("untrusted_business_data"),
    visibility_reason: z.literal("current_actor_authorized"),
    evidence_ids: z.array(OpaqueIdSchema).length(1),
  })
  .strict()
  .superRefine((match, context) => {
    const identityIds = [
      match.job_ref.id,
      ...match.anchor_refs.map((reference) => reference.id),
      ...(match.conversion.state === "converted"
        ? [match.conversion.opportunity_ref.id, match.conversion.project_ref.id]
        : []),
    ];
    if (identityIds.some((id) => !isCanonicalLowercaseUuid(id))) {
      context.addIssue({
        code: "custom",
        path: ["job_ref"],
        message: "Discovery UUID identities must use canonical lowercase text",
      });
    }
    if (
      match.job_ref.kind !== match.status.kind ||
      match.job_ref.kind !== match.dates.kind
    ) {
      context.addIssue({
        code: "custom",
        path: ["job_ref"],
        message: "Job reference, status, and dates must use one job kind",
      });
    }
    if (!lifecycleMatchesStatus(match)) {
      context.addIssue({
        code: "custom",
        path: ["lifecycle_state"],
        message: "Normalized lifecycle must match the current status",
      });
    }
    const anchorIdentities = match.anchor_refs.map(referenceIdentity);
    if (
      !valuesAreUnique(anchorIdentities) ||
      !anchorIdentities.includes(referenceIdentity(match.job_ref))
    ) {
      context.addIssue({
        code: "custom",
        path: ["anchor_refs"],
        message: "Job anchors must be unique and include the canonical job",
      });
    }
    if (match.conversion.state === "converted") {
      const expected = [
        referenceIdentity(match.conversion.opportunity_ref),
        referenceIdentity(match.conversion.project_ref),
      ];
      if (
        match.job_ref.kind !== "project" ||
        match.job_ref.id !== match.conversion.project_ref.id ||
        anchorIdentities.length !== 2 ||
        !expected.every((identity) => anchorIdentities.includes(identity))
      ) {
        context.addIssue({
          code: "custom",
          path: ["conversion"],
          message: "Converted jobs require one canonical reciprocal project",
        });
      }
    } else if (
      ((match.conversion.state === "not_converted" ||
        match.conversion.state === "linked_project_not_returned") &&
        match.job_ref.kind !== "opportunity") ||
      ((match.conversion.state === "standalone_project" ||
        match.conversion.state === "linked_opportunity_not_returned") &&
        match.job_ref.kind !== "project") ||
      match.anchor_refs.length !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["conversion"],
        message: "Unpaired jobs require the matching single-anchor state",
      });
    }
    if (match.match_basis.field === "address" && match.address === null) {
      context.addIssue({
        code: "custom",
        path: ["address"],
        message: "Address matches require a returned address",
      });
    }
  });

export const DiscoveryGapSchema = z.enum([
  "SOURCE_QUERY_BOUND",
  "SOURCE_DATA_INVALID",
]);
const DiscoveryGapsSchema = z
  .array(DiscoveryGapSchema)
  .max(1)
  .refine(valuesAreUnique, "Discovery gaps must be unique");

function discoveryDataSchema<TMatchSchema extends z.ZodType>(
  matchSchema: TMatchSchema,
  identity: (match: z.infer<TMatchSchema>) => string
) {
  return z
    .object({
      prompt_safety_directive: z.literal(DISCOVERY_PROMPT_SAFETY_DIRECTIVE),
      gaps: DiscoveryGapsSchema,
      matches: z.array(matchSchema).max(MAX_DISCOVERY_MATCHES),
      returned_match_count: z.number().int().safe().nonnegative(),
      result_budget_omitted_count: z.number().int().safe().nonnegative(),
    })
    .strict()
    .superRefine((data, context) => {
      if (data.returned_match_count !== data.matches.length) {
        context.addIssue({
          code: "custom",
          path: ["returned_match_count"],
          message: "Returned match count must match retained matches",
        });
      }
      if (
        data.gaps.length > 0 &&
        (data.matches.length > 0 ||
          data.returned_match_count !== 0 ||
          data.result_budget_omitted_count !== 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["gaps"],
          message: "Discovery source gaps require an empty terminal result",
        });
      }
      if (
        data.result_budget_omitted_count >
        MAX_DISCOVERY_MATCHES - data.matches.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["result_budget_omitted_count"],
          message: "Budget omissions cannot exceed the retained discovery page",
        });
      }
      if (!valuesAreUnique(data.matches.map(identity))) {
        context.addIssue({
          code: "custom",
          path: ["matches"],
          message: "Discovery matches must have unique canonical references",
        });
      }
      if (
        !valuesAreUnique(
          data.matches.flatMap(
            (match) =>
              (match as { readonly evidence_ids: readonly string[] })
                .evidence_ids
          )
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["matches"],
          message: "Discovery match evidence IDs must be unique",
        });
      }
    });
}

export const CustomerDiscoveryDataSchema = discoveryDataSchema(
  CustomerDiscoveryMatchSchema,
  (match) => `${match.customer_ref.kind}:${match.customer_ref.id}`
);

function jobAliasIdentities(
  match: z.infer<typeof JobDiscoveryMatchSchema>
): Set<string> {
  const references = [match.job_ref, ...match.anchor_refs];
  if (match.conversion.state === "converted") {
    references.push(
      match.conversion.opportunity_ref,
      match.conversion.project_ref
    );
  }
  return new Set(references.map(referenceIdentity));
}

export const JobDiscoveryDataSchema = discoveryDataSchema(
  JobDiscoveryMatchSchema,
  (match) => referenceIdentity(match.job_ref)
).superRefine((data, context) => {
  const claimedAliases = new Set<string>();
  for (const [index, match] of data.matches.entries()) {
    for (const identity of jobAliasIdentities(match)) {
      if (claimedAliases.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["matches", index, "anchor_refs"],
          message: "A job reference can belong to only one discovery card",
        });
      }
      claimedAliases.add(identity);
    }
  }
});

type DiscoveryProjectionReference = {
  readonly kind: "client" | "sub_client" | "opportunity" | "project";
  readonly id: string;
};

type DiscoverySourceAtom = {
  readonly source_domain: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly version: string;
};

type DiscoveryEvidenceAtom = DiscoverySourceAtom & {
  readonly evidence_id: string;
  readonly occurred_at: string;
  readonly relationship: string;
  readonly trust: string;
  readonly excerpt?: string;
  readonly locator: string;
};

function projectionSourceId(
  reference: DiscoveryProjectionReference,
  ordinal: number
): string {
  return `${reference.kind}:${reference.id}:ordinal:${ordinal}`;
}

function projectionEvidenceId(
  kind: "customer" | "job",
  reference: DiscoveryProjectionReference,
  ordinal: number
): string {
  return `evidence:${kind}_discovery_projection:${projectionSourceId(reference, ordinal)}`;
}

function projectionOrdinal(
  source: DiscoverySourceAtom | undefined,
  reference: DiscoveryProjectionReference
): number | null {
  if (source === undefined) return null;
  const prefix = `${reference.kind}:${reference.id}:ordinal:`;
  if (!source.source_id.startsWith(prefix)) return null;
  const suffix = source.source_id.slice(prefix.length);
  if (!/^(?:[1-9][0-9]{0,2})$/.test(suffix)) return null;
  const ordinal = Number(suffix);
  return ordinal <= 500 ? ordinal : null;
}

function collectionEvidenceId(
  kind: "customer" | "job",
  companyId: string
): string {
  return `evidence:${kind}_discovery_collection_projection:company:${companyId}`;
}

function canonicalEvidenceLocator(evidenceId: string): string {
  return `ops://evidence/${encodeURIComponent(evidenceId)}`;
}

function hasCanonicalProjectionVersion(
  sourceType: string,
  version: string
): boolean {
  const prefix = `${sourceType}:v1:sha256:`;
  return (
    version.startsWith(prefix) &&
    /^[a-f0-9]{64}$/.test(version.slice(prefix.length))
  );
}

function sourceMatches(
  source: DiscoverySourceAtom | undefined,
  expected: {
    readonly source_type: string;
    readonly source_id: string;
  }
): source is DiscoverySourceAtom {
  return (
    source !== undefined &&
    source.source_domain === "operations" &&
    source.source_type === expected.source_type &&
    source.source_id === expected.source_id &&
    hasCanonicalProjectionVersion(source.source_type, source.version)
  );
}

function evidenceMatches(
  evidence: DiscoveryEvidenceAtom | undefined,
  source: DiscoverySourceAtom | undefined,
  expectedEvidenceId: string,
  readAt: string
): boolean {
  return (
    evidence !== undefined &&
    source !== undefined &&
    evidence.evidence_id === expectedEvidenceId &&
    evidence.source_domain === source.source_domain &&
    evidence.source_type === source.source_type &&
    evidence.source_id === source.source_id &&
    evidence.version === source.version &&
    evidence.occurred_at === readAt &&
    evidence.relationship === "supports" &&
    evidence.trust === "authoritative_ops" &&
    evidence.excerpt === undefined &&
    evidence.locator === canonicalEvidenceLocator(expectedEvidenceId)
  );
}

function validateDiscoveryResult<
  TMatch extends { readonly evidence_ids: readonly string[] },
>(
  result: {
    readonly company_id: string;
    readonly freshness: {
      readonly read_at: string;
      readonly source_versions: readonly DiscoverySourceAtom[];
    };
    readonly data: {
      readonly gaps: readonly string[];
      readonly matches: readonly TMatch[];
      readonly result_budget_omitted_count: number;
    };
    readonly evidence: readonly DiscoveryEvidenceAtom[];
    readonly warnings: readonly {
      readonly code: string;
      readonly message: string;
    }[];
    readonly page: {
      readonly next_cursor: string | null;
      readonly has_more: boolean;
    };
  },
  kind: "customer" | "job",
  referenceForMatch: (match: TMatch) => DiscoveryProjectionReference,
  context: z.RefinementCtx
): void {
  const collectionSourceType = `${kind}_discovery_collection_projection`;
  const childSourceType = `${kind}_discovery_projection`;
  const sources = result.freshness.source_versions;
  const collectionSource = sources[1];
  const expectedCollectionEvidenceId = collectionEvidenceId(
    kind,
    result.company_id
  );
  const fence = sources[0];
  const fenceIsCanonical =
    fence !== undefined &&
    fence.source_domain === "operations" &&
    fence.source_type === "operational_read_revision" &&
    fence.source_id === "private.agent_operational_read_revisions" &&
    /^revision:(?:0|[1-9][0-9]*)$/.test(fence.version);
  const collectionIsCanonical = sourceMatches(collectionSource, {
    source_type: collectionSourceType,
    source_id: `company:${result.company_id}`,
  });
  const collectionEvidenceIsCanonical = evidenceMatches(
    result.evidence[0],
    collectionSource,
    expectedCollectionEvidenceId,
    result.freshness.read_at
  );
  const childOrdinals = result.data.matches.map((match, index) =>
    projectionOrdinal(sources[index + 2], referenceForMatch(match))
  );
  const childOrdinalsAreContiguous = childOrdinals.every(
    (ordinal, index) =>
      ordinal !== null &&
      (index === 0 || ordinal === childOrdinals[index - 1]! + 1)
  );
  const childrenAreCanonical = result.data.matches.every((match, index) => {
    const ordinal = childOrdinals[index];
    if (typeof ordinal !== "number") return false;
    const reference = referenceForMatch(match);
    const expectedEvidenceId = projectionEvidenceId(kind, reference, ordinal);
    const childSource = sources[index + 2];
    return (
      match.evidence_ids.length === 1 &&
      match.evidence_ids[0] === expectedEvidenceId &&
      sourceMatches(childSource, {
        source_type: childSourceType,
        source_id: projectionSourceId(reference, ordinal),
      }) &&
      evidenceMatches(
        result.evidence[index + 1],
        childSource,
        expectedEvidenceId,
        result.freshness.read_at
      )
    );
  });
  if (
    sources.length !== result.data.matches.length + 2 ||
    result.evidence.length !== result.data.matches.length + 1 ||
    !fenceIsCanonical ||
    !collectionIsCanonical ||
    !collectionEvidenceIsCanonical ||
    !childOrdinalsAreContiguous ||
    !childrenAreCanonical
  ) {
    context.addIssue({
      code: "custom",
      path: ["evidence"],
      message:
        "Discovery proofs must follow the exact ordered projection identity contract",
    });
  }

  if (
    result.data.gaps.length > 0 &&
    (result.page.next_cursor !== null ||
      result.page.has_more ||
      result.warnings.length > 0)
  ) {
    context.addIssue({
      code: "custom",
      path: ["page"],
      message: "Discovery source gaps require a terminal warning-free page",
    });
  }

  const hasBudgetOmissions = result.data.result_budget_omitted_count > 0;
  const hasExactBudgetWarning =
    result.warnings.length === 1 &&
    result.warnings[0]?.code === DISCOVERY_RESULT_BUDGET_WARNING.code &&
    result.warnings[0]?.message === DISCOVERY_RESULT_BUDGET_WARNING.message;
  if (
    (hasBudgetOmissions && !hasExactBudgetWarning) ||
    (!hasBudgetOmissions && result.warnings.length !== 0)
  ) {
    context.addIssue({
      code: "custom",
      path: ["warnings"],
      message:
        "Budget omissions require exactly one fixed result-budget warning",
    });
  }

  if (
    discoveryPromptSerializedLength(result) > MAX_DISCOVERY_OUTPUT_CHARACTERS
  ) {
    context.addIssue({
      code: "custom",
      path: [],
      message: "Discovery result exceeds the prompt-safe character budget",
    });
  }
}

const DiscoveryCompanyIdSchema = z
  .string()
  .uuid()
  .refine(isCanonicalLowercaseUuid, "Company UUID must use lowercase text");

export const CustomerDiscoveryResultSchema = createAgentResultSchema(
  CustomerDiscoveryDataSchema
)
  .extend({
    company_id: DiscoveryCompanyIdSchema,
    page: SignedDiscoveryCursorPageSchema,
  })
  .superRefine((result, context) => {
    validateDiscoveryResult(
      result,
      "customer",
      (match) => match.customer_ref,
      context
    );
  });

export const JobDiscoveryResultSchema = createAgentResultSchema(
  JobDiscoveryDataSchema
)
  .extend({
    company_id: DiscoveryCompanyIdSchema,
    page: SignedDiscoveryCursorPageSchema,
  })
  .superRefine((result, context) => {
    validateDiscoveryResult(result, "job", (match) => match.job_ref, context);
  });

export type SearchCustomersInput = z.input<typeof SearchCustomersInputSchema>;
export type ParsedSearchCustomersInput = Readonly<
  z.output<typeof SearchCustomersInputSchema>
>;
export type CustomerDiscoveryMatch = z.infer<
  typeof CustomerDiscoveryMatchSchema
>;
export type CustomerDiscoveryData = z.infer<typeof CustomerDiscoveryDataSchema>;
export type CustomerDiscoveryResult = z.infer<
  typeof CustomerDiscoveryResultSchema
>;

export type SearchJobsInput = z.input<typeof SearchJobsInputSchema>;
export type ParsedSearchJobsInput = Readonly<
  z.output<typeof SearchJobsInputSchema>
>;
export type JobDiscoveryMatch = z.infer<typeof JobDiscoveryMatchSchema>;
export type JobDiscoveryData = z.infer<typeof JobDiscoveryDataSchema>;
export type JobDiscoveryResult = z.infer<typeof JobDiscoveryResultSchema>;
