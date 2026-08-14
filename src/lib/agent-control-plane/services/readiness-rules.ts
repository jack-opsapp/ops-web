import "server-only";

import { z } from "zod-v4";

import {
  OpaqueIdSchema,
  READINESS_RULE_CODES,
  ReadinessRuleCodeSchema,
  type ReadinessRuleCode,
} from "@/lib/agent-control-plane/contracts";
import { parsePropertyAddressIdentity } from "@/lib/utils/property-address-identity";

export { READINESS_RULE_CODES, ReadinessRuleCodeSchema };

export const MAX_READINESS_OCCURRENCE_REFS = 50;

export const READINESS_RULES = Object.freeze([
  Object.freeze({
    code: "SITE_PHOTOS_MISSING" as const,
    revision: "site-photos-missing:v1" as const,
    severity: "warning" as const,
  }),
  Object.freeze({
    code: "CUSTOMER_RECORD_UNRESOLVED" as const,
    revision: "customer-record-unresolved:v1" as const,
    severity: "blocking" as const,
  }),
  Object.freeze({
    code: "SCHEDULE_UNCONFIRMED" as const,
    revision: "schedule-unconfirmed:v1" as const,
    severity: "warning" as const,
  }),
  Object.freeze({
    code: "CREW_UNASSIGNED" as const,
    revision: "crew-unassigned:v1" as const,
    severity: "blocking" as const,
  }),
  Object.freeze({
    code: "ADDRESS_INCOMPLETE" as const,
    revision: "address-incomplete:v1" as const,
    severity: "blocking" as const,
  }),
]);

export const READINESS_GAP_CODES = [
  "SOURCE_UNAVAILABLE",
  "SOURCE_QUERY_BOUND",
  "SOURCE_DATA_INVALID",
] as const;
export const ReadinessGapCodeSchema = z.enum(READINESS_GAP_CODES);

export const READINESS_SOURCE_KINDS = [
  "project_photos",
  "customer_record",
  "task_schedule",
  "task_assignments",
  "project_address",
] as const;
export const ReadinessSourceKindSchema = z.enum(READINESS_SOURCE_KINDS);

function notEvaluatedFactSourceSchema<
  TSourceKind extends (typeof READINESS_SOURCE_KINDS)[number],
>(sourceKind: TSourceKind) {
  return z
    .object({
      status: z.literal("not_evaluated"),
      gap_code: ReadinessGapCodeSchema,
      source_kind: z.literal(sourceKind),
    })
    .strict();
}

const OccurrenceRefsSchema = z
  .array(OpaqueIdSchema)
  .max(MAX_READINESS_OCCURRENCE_REFS)
  .refine(
    (refs) => new Set(refs).size === refs.length,
    "Occurrence references must be unique"
  );

function validateBoundedOccurrenceFact(
  eligibleCount: number,
  issueCount: number,
  refs: readonly string[],
  countField: string,
  refsField: string,
  context: z.RefinementCtx
) {
  if (issueCount > eligibleCount) {
    context.addIssue({
      code: "custom",
      path: [countField],
      message: "Issue count cannot exceed eligible occurrence count",
    });
  }

  const expectedRetainedCount = Math.min(
    issueCount,
    MAX_READINESS_OCCURRENCE_REFS
  );
  if (refs.length !== expectedRetainedCount) {
    context.addIssue({
      code: "custom",
      path: [refsField],
      message: "Retained occurrence references must match the bounded count",
    });
  }
}

const ScheduleAvailableFactSourceSchema = z
  .object({
    eligible_occurrence_count: z.number().int().safe().positive(),
    unconfirmed_occurrence_count: z.number().int().safe().nonnegative(),
    unconfirmed_occurrence_refs: OccurrenceRefsSchema,
  })
  .strict()
  .superRefine((fact, context) =>
    validateBoundedOccurrenceFact(
      fact.eligible_occurrence_count,
      fact.unconfirmed_occurrence_count,
      fact.unconfirmed_occurrence_refs,
      "unconfirmed_occurrence_count",
      "unconfirmed_occurrence_refs",
      context
    )
  );

const CrewAvailableFactSourceSchema = z
  .object({
    eligible_occurrence_count: z.number().int().safe().positive(),
    unassigned_occurrence_count: z.number().int().safe().nonnegative(),
    unassigned_occurrence_refs: OccurrenceRefsSchema,
  })
  .strict()
  .superRefine((fact, context) =>
    validateBoundedOccurrenceFact(
      fact.eligible_occurrence_count,
      fact.unassigned_occurrence_count,
      fact.unassigned_occurrence_refs,
      "unassigned_occurrence_count",
      "unassigned_occurrence_refs",
      context
    )
  );

export const SitePhotoFactSourceSchema = z.union([
  z
    .object({ usable_photo_count: z.number().int().safe().nonnegative() })
    .strict(),
  notEvaluatedFactSourceSchema("project_photos"),
]);

const CustomerRecordFactSourceSchema = z.union([
  z.object({ resolved: z.boolean() }).strict(),
  notEvaluatedFactSourceSchema("customer_record"),
]);

const ScheduleFactSourceSchema = z.union([
  ScheduleAvailableFactSourceSchema,
  notEvaluatedFactSourceSchema("task_schedule"),
]);

const CrewFactSourceSchema = z.union([
  CrewAvailableFactSourceSchema,
  notEvaluatedFactSourceSchema("task_assignments"),
]);

const AddressFactSourceSchema = z.union([
  z.object({ complete: z.boolean() }).strict(),
  notEvaluatedFactSourceSchema("project_address"),
]);

const ActiveRemotePhotosBySourceSchema = z
  .object({
    site_visit: z.number().int().safe().nonnegative(),
    in_progress: z.number().int().safe().nonnegative(),
    completion: z.number().int().safe().nonnegative(),
    other: z.number().int().safe().nonnegative(),
    measurement: z.number().int().safe().nonnegative(),
    deck_design: z.number().int().safe().nonnegative(),
  })
  .strict();

function addSafeCounts(left: number, right: number): number | null {
  return left <= Number.MAX_SAFE_INTEGER - right ? left + right : null;
}

export const RawSitePhotoSourceSchema = z.union([
  z
    .object({
      available: z.literal(true),
      active_remote_by_source: ActiveRemotePhotosBySourceSchema,
      structured_row_count: z.number().int().safe().nonnegative(),
      tombstone_count: z.number().int().safe().nonnegative(),
      malformed_or_local_count: z.number().int().safe().nonnegative(),
      legacy_remote_count: z.number().int().safe().nonnegative(),
    })
    .strict()
    .superRefine((source, context) => {
      const partition = [
        ...Object.values(source.active_remote_by_source),
        source.tombstone_count,
        source.malformed_or_local_count,
      ].reduce<number | null>(
        (total, count) => (total === null ? null : addSafeCounts(total, count)),
        0
      );
      if (partition === null || partition !== source.structured_row_count) {
        context.addIssue({
          code: "custom",
          path: ["structured_row_count"],
          message:
            "Structured photo total must equal the complete source/status partition",
        });
      }
    }),
  notEvaluatedFactSourceSchema("project_photos"),
]);

const RawAddressSourceSchema = z.union([
  z
    .object({
      available: z.literal(true),
      project_address: z.string().trim().max(2_000).nullable(),
    })
    .strict(),
  notEvaluatedFactSourceSchema("project_address"),
]);

export const ReadinessRuleRawSourcesSchema = z
  .object({
    site_photos: RawSitePhotoSourceSchema,
    customer_record: CustomerRecordFactSourceSchema,
    schedule: ScheduleFactSourceSchema,
    crew: CrewFactSourceSchema,
    address: RawAddressSourceSchema,
  })
  .strict();

export const ReadinessRuleFactsSchema = z
  .object({
    site_photos: SitePhotoFactSourceSchema,
    customer_record: CustomerRecordFactSourceSchema,
    schedule: ScheduleFactSourceSchema,
    crew: CrewFactSourceSchema,
    address: AddressFactSourceSchema,
  })
  .strict();

export const ReadinessRuleEvaluationStatusSchema = z.enum([
  "issue",
  "clear",
  "not_evaluated",
]);

const FIXED_NOT_EVALUATED_FACT =
  "This readiness check could not be evaluated." as const;

const ReadinessGapSchema = z
  .object({
    code: ReadinessGapCodeSchema,
    source_kind: ReadinessSourceKindSchema,
  })
  .strict();

function evaluationSchema<TCode extends ReadinessRuleCode>(
  code: TCode,
  revision: string,
  severity: "warning" | "blocking",
  issueFact: z.ZodType<string>,
  clearFact: z.ZodType<string>
) {
  const base = {
    rule_code: z.literal(code),
    rule_revision: z.literal(revision),
    severity: z.literal(severity),
  };
  return z.discriminatedUnion("status", [
    z.object({ ...base, status: z.literal("issue"), fact: issueFact }).strict(),
    z.object({ ...base, status: z.literal("clear"), fact: clearFact }).strict(),
    z
      .object({
        ...base,
        status: z.literal("not_evaluated"),
        fact: z.literal(FIXED_NOT_EVALUATED_FACT),
        gap: ReadinessGapSchema,
      })
      .strict(),
  ]);
}

const CountFactSchema = z
  .string()
  .regex(
    /^\d+ scheduled occurrences? (?:is unconfirmed|are unconfirmed|has no assigned crew|have no assigned crew)\.$/
  );

export const SitePhotoReadinessEvaluationSchema = evaluationSchema(
  "SITE_PHOTOS_MISSING",
  "site-photos-missing:v1",
  "warning",
  z.literal("No usable site photos are on file."),
  z.literal("Usable site photos are on file.")
);

export const ReadinessRuleEvaluationSchema = z.union([
  SitePhotoReadinessEvaluationSchema,
  evaluationSchema(
    "CUSTOMER_RECORD_UNRESOLVED",
    "customer-record-unresolved:v1",
    "blocking",
    z.literal("No current customer record is linked to this job."),
    z.literal("A current customer record is linked to this job.")
  ),
  evaluationSchema(
    "SCHEDULE_UNCONFIRMED",
    "schedule-unconfirmed:v1",
    "warning",
    CountFactSchema,
    z.literal("All scheduled occurrences are confirmed.")
  ),
  evaluationSchema(
    "CREW_UNASSIGNED",
    "crew-unassigned:v1",
    "blocking",
    CountFactSchema,
    z.literal("All scheduled occurrences have assigned crew.")
  ),
  evaluationSchema(
    "ADDRESS_INCOMPLETE",
    "address-incomplete:v1",
    "blocking",
    z.literal("The job address is incomplete."),
    z.literal("The job address is complete.")
  ),
]);

const EvaluateReadinessRulesOptionsSchema = z
  .object({
    includeClear: z.boolean().default(false),
    ruleCodes: z
      .array(ReadinessRuleCodeSchema)
      .min(1)
      .max(READINESS_RULE_CODES.length)
      .refine(
        (codes) => new Set(codes).size === codes.length,
        "Readiness rule codes must be unique"
      )
      .default([...READINESS_RULE_CODES]),
  })
  .strict();

export interface EvaluateReadinessRulesOptions {
  readonly includeClear?: boolean;
  readonly ruleCodes?: readonly ReadinessRuleCode[];
}

function pluralizedOccurrenceFact(
  count: number,
  singular: string,
  plural: string
): string {
  return `${count} scheduled occurrence${count === 1 ? "" : "s"} ${
    count === 1 ? singular : plural
  }.`;
}

type ReadinessRuleFactSource = ReadinessRuleFacts[keyof ReadinessRuleFacts];
type NotEvaluatedFactSource = Extract<
  ReadinessRuleFactSource,
  { status: "not_evaluated" }
>;

function isNotEvaluated<TSource extends object>(
  source: TSource
): source is TSource & NotEvaluatedFactSource {
  return "status" in source && source.status === "not_evaluated";
}

export function deriveReadinessRuleFacts(
  rawSources: ReadinessRuleRawSources
): ReadinessRuleFacts {
  const sources = ReadinessRuleRawSourcesSchema.parse(rawSources);
  const sitePhotos = deriveSitePhotoReadinessFact(sources.site_photos);
  const address = isNotEvaluated(sources.address)
    ? sources.address
    : {
        complete:
          parsePropertyAddressIdentity(sources.address.project_address) !==
          null,
      };

  return ReadinessRuleFactsSchema.parse({
    site_photos: sitePhotos,
    customer_record: sources.customer_record,
    schedule: sources.schedule,
    crew: sources.crew,
    address,
  });
}

export function deriveSitePhotoReadinessFact(
  rawSource: RawSitePhotoSource
): SitePhotoFactSource {
  const source = RawSitePhotoSourceSchema.parse(rawSource);
  return SitePhotoFactSourceSchema.parse(
    isNotEvaluated(source)
      ? source
      : {
          usable_photo_count:
            source.structured_row_count === 0
              ? source.legacy_remote_count
              : source.active_remote_by_source.site_visit +
                source.active_remote_by_source.in_progress +
                source.active_remote_by_source.completion +
                source.active_remote_by_source.other +
                source.active_remote_by_source.measurement,
        }
  );
}

function evaluationGap(source: NotEvaluatedFactSource) {
  return { code: source.gap_code, source_kind: source.source_kind } as const;
}

function evaluateRule(
  code: ReadinessRuleCode,
  facts: ReadinessRuleFacts
): ReadinessRuleEvaluation {
  switch (code) {
    case "SITE_PHOTOS_MISSING": {
      return evaluateSitePhotoReadinessFact(facts.site_photos);
    }
    case "CUSTOMER_RECORD_UNRESOLVED": {
      const source = facts.customer_record;
      if (isNotEvaluated(source)) {
        return {
          rule_code: code,
          rule_revision: "customer-record-unresolved:v1",
          status: "not_evaluated",
          severity: "blocking",
          fact: FIXED_NOT_EVALUATED_FACT,
          gap: evaluationGap(source),
        };
      }
      return {
        rule_code: code,
        rule_revision: "customer-record-unresolved:v1",
        status: source.resolved ? "clear" : "issue",
        severity: "blocking",
        fact: source.resolved
          ? "A current customer record is linked to this job."
          : "No current customer record is linked to this job.",
      };
    }
    case "SCHEDULE_UNCONFIRMED": {
      const source = facts.schedule;
      if (isNotEvaluated(source)) {
        return {
          rule_code: code,
          rule_revision: "schedule-unconfirmed:v1",
          status: "not_evaluated",
          severity: "warning",
          fact: FIXED_NOT_EVALUATED_FACT,
          gap: evaluationGap(source),
        };
      }
      const count = source.unconfirmed_occurrence_count;
      return {
        rule_code: code,
        rule_revision: "schedule-unconfirmed:v1",
        status: count > 0 ? "issue" : "clear",
        severity: "warning",
        fact:
          count > 0
            ? pluralizedOccurrenceFact(
                count,
                "is unconfirmed",
                "are unconfirmed"
              )
            : "All scheduled occurrences are confirmed.",
      };
    }
    case "CREW_UNASSIGNED": {
      const source = facts.crew;
      if (isNotEvaluated(source)) {
        return {
          rule_code: code,
          rule_revision: "crew-unassigned:v1",
          status: "not_evaluated",
          severity: "blocking",
          fact: FIXED_NOT_EVALUATED_FACT,
          gap: evaluationGap(source),
        };
      }
      const count = source.unassigned_occurrence_count;
      return {
        rule_code: code,
        rule_revision: "crew-unassigned:v1",
        status: count > 0 ? "issue" : "clear",
        severity: "blocking",
        fact:
          count > 0
            ? pluralizedOccurrenceFact(
                count,
                "has no assigned crew",
                "have no assigned crew"
              )
            : "All scheduled occurrences have assigned crew.",
      };
    }
    case "ADDRESS_INCOMPLETE": {
      const source = facts.address;
      if (isNotEvaluated(source)) {
        return {
          rule_code: code,
          rule_revision: "address-incomplete:v1",
          status: "not_evaluated",
          severity: "blocking",
          fact: FIXED_NOT_EVALUATED_FACT,
          gap: evaluationGap(source),
        };
      }
      return {
        rule_code: code,
        rule_revision: "address-incomplete:v1",
        status: source.complete ? "clear" : "issue",
        severity: "blocking",
        fact: source.complete
          ? "The job address is complete."
          : "The job address is incomplete.",
      };
    }
  }
}

export function evaluateSitePhotoReadinessFact(
  rawFact: SitePhotoFactSource
): SitePhotoReadinessEvaluation {
  const source = SitePhotoFactSourceSchema.parse(rawFact);
  if (isNotEvaluated(source)) {
    return SitePhotoReadinessEvaluationSchema.parse({
      rule_code: "SITE_PHOTOS_MISSING",
      rule_revision: "site-photos-missing:v1",
      status: "not_evaluated",
      severity: "warning",
      fact: FIXED_NOT_EVALUATED_FACT,
      gap: evaluationGap(source),
    });
  }
  const issue = source.usable_photo_count === 0;
  return SitePhotoReadinessEvaluationSchema.parse({
    rule_code: "SITE_PHOTOS_MISSING",
    rule_revision: "site-photos-missing:v1",
    status: issue ? "issue" : "clear",
    severity: "warning",
    fact: issue
      ? "No usable site photos are on file."
      : "Usable site photos are on file.",
  });
}

export function evaluateReadinessRules(
  rawFacts: ReadinessRuleFacts,
  rawOptions: EvaluateReadinessRulesOptions = {}
): readonly ReadinessRuleEvaluation[] {
  const facts = ReadinessRuleFactsSchema.parse(rawFacts);
  const options = EvaluateReadinessRulesOptionsSchema.parse(rawOptions);
  const selectedCodes = new Set(options.ruleCodes);

  return READINESS_RULE_CODES.flatMap((code) => {
    if (!selectedCodes.has(code)) return [];
    const evaluation = ReadinessRuleEvaluationSchema.parse(
      evaluateRule(code, facts)
    );
    if (evaluation.status === "clear" && !options.includeClear) return [];
    return [evaluation];
  });
}

export type ReadinessRuleFacts = z.infer<typeof ReadinessRuleFactsSchema>;
export type ReadinessRuleRawSources = z.infer<
  typeof ReadinessRuleRawSourcesSchema
>;
export type RawSitePhotoSource = z.infer<typeof RawSitePhotoSourceSchema>;
export type SitePhotoFactSource = z.infer<typeof SitePhotoFactSourceSchema>;
export type SitePhotoReadinessEvaluation = z.infer<
  typeof SitePhotoReadinessEvaluationSchema
>;
export type ReadinessRuleEvaluationStatus = z.infer<
  typeof ReadinessRuleEvaluationStatusSchema
>;
export type ReadinessGapCode = z.infer<typeof ReadinessGapCodeSchema>;
export type ReadinessSourceKind = z.infer<typeof ReadinessSourceKindSchema>;
export type ReadinessRuleEvaluation = z.infer<
  typeof ReadinessRuleEvaluationSchema
>;
