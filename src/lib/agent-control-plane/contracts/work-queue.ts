import { z } from "zod-v4";

import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  P2_FETCH_LIMIT,
  P2_MAX_PAGE_ITEMS,
  P2_MAX_SOURCE_ROWS,
  createP2CanonicalTextSchema,
  assertP2NoForbiddenFields,
} from "./p2-common";
import {
  P2EntityProofSchema,
  P2EvidenceIdentitySchema,
  P2ProofRefSchema,
} from "./p2-proof";

export const WORK_QUEUE_SCHEMA_REVISION = "2026-08-22.v1" as const;
export const WORK_QUEUE_MAX_PAGE_ITEMS = P2_MAX_PAGE_ITEMS;
export const WORK_QUEUE_FETCH_LIMIT = P2_FETCH_LIMIT;
export const WORK_QUEUE_MAX_SOURCE_ROWS = P2_MAX_SOURCE_ROWS;
export const WORK_QUEUE_MAX_AGGREGATE_SOURCE_ROWS =
  9 * (P2_MAX_SOURCE_ROWS - 1);

export const WORK_QUEUE_SOURCES = Object.freeze([
  "task",
  "lead",
  "correspondence",
  "commitment",
  "match_review",
  "schedule",
  "financial_document",
  "payment",
  "expense",
] as const);

export const WorkQueueSourceSchema = z.enum(WORK_QUEUE_SOURCES);
const WorkQueueCursorTokenSchema = z.string().min(16).max(8_192);
const ExplicitSourcesSchema = z
  .array(WorkQueueSourceSchema)
  .min(1)
  .max(WORK_QUEUE_SOURCES.length)
  .refine(
    (values) => new Set(values).size === values.length,
    "WORK_QUEUE_SOURCES_NOT_UNIQUE"
  )
  .transform((values) =>
    WORK_QUEUE_SOURCES.filter((source) => values.includes(source))
  );

export const ListWorkQueueInputSchema = z
  .object({
    sources: ExplicitSourcesSchema.optional(),
    cursor: WorkQueueCursorTokenSchema.optional(),
    limit: z.number().int().min(1).max(WORK_QUEUE_MAX_PAGE_ITEMS).default(25),
  })
  .strict();

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function normalizeWorkQueueSelections(input: unknown) {
  const parsed = ListWorkQueueInputSchema.parse(input);
  const origin = parsed.sources === undefined ? "default" : "explicit";
  return deepFreeze(
    (parsed.sources ?? WORK_QUEUE_SOURCES).map((source) => ({ source, origin }))
  );
}

const QueueRefSchema = z
  .object({ kind: WorkQueueSourceSchema, id: P2CanonicalUuidSchema })
  .strict();
const JobRefSchema = z
  .object({
    kind: z.enum(["opportunity", "project"]),
    id: P2CanonicalUuidSchema,
  })
  .strict();
const BaseCardShape = {
  queue_ref: QueueRefSchema,
  priority: z.number().int().min(0).max(99),
  attention_at: P2CanonicalTimestampSchema,
} as const;
const ShortTextSchema = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 256,
  maximumUtf8Bytes: 1_024,
});
const SubjectTextSchema = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 512,
  maximumUtf8Bytes: 2_048,
});
const SnippetTextSchema = createP2CanonicalTextSchema({
  minimumScalars: 0,
  maximumScalars: 1_000,
  maximumUtf8Bytes: 4_000,
  allowTextWhitespace: true,
});

export const WorkQueueCardSchema = z.discriminatedUnion("source", [
  z
    .object({
      ...BaseCardShape,
      source: z.literal("task"),
      task_ref: z
        .object({ kind: z.literal("task"), id: P2CanonicalUuidSchema })
        .strict(),
      job_ref: JobRefSchema,
      reason: z.enum(["overdue", "unassigned", "confirmation_required"]),
      title: ShortTextSchema,
      content_kind: z.literal("untrusted_business_data"),
    })
    .strict(),
  z
    .object({
      ...BaseCardShape,
      source: z.literal("lead"),
      job_ref: z
        .object({ kind: z.literal("opportunity"), id: P2CanonicalUuidSchema })
        .strict(),
      reason: z.enum(["follow_up_due", "operator_action_required"]),
      title: ShortTextSchema.optional(),
      content_kind: z.literal("untrusted_business_data"),
    })
    .strict(),
  z
    .object({
      ...BaseCardShape,
      source: z.literal("correspondence"),
      thread_ref: z
        .object({ kind: z.literal("email_thread"), id: P2CanonicalUuidSchema })
        .strict(),
      job_ref: JobRefSchema,
      reason: z.literal("unresolved_correspondence"),
      subject: SubjectTextSchema.optional(),
      snippet: SnippetTextSchema,
      content_kind: z.literal("untrusted_business_data"),
    })
    .strict(),
  z
    .object({
      ...BaseCardShape,
      source: z.literal("commitment"),
      thread_ref: z
        .object({ kind: z.literal("email_thread"), id: P2CanonicalUuidSchema })
        .strict(),
      job_ref: JobRefSchema.optional(),
      reason: z.literal("unresolved_commitment"),
    })
    .strict(),
  z
    .object({
      ...BaseCardShape,
      source: z.literal("match_review"),
      activity_ref: z
        .object({ kind: z.literal("activity"), id: P2CanonicalUuidSchema })
        .strict(),
      thread_ref: z
        .object({ kind: z.literal("email_thread"), id: P2CanonicalUuidSchema })
        .strict()
        .optional(),
      job_ref: JobRefSchema.optional(),
      reason: z.literal("match_needs_review"),
    })
    .strict(),
  z
    .object({
      ...BaseCardShape,
      source: z.literal("schedule"),
      task_ref: z
        .object({ kind: z.literal("task"), id: P2CanonicalUuidSchema })
        .strict(),
      job_ref: JobRefSchema,
      reason: z.enum(["confirmation_required", "starts_soon"]),
      title: ShortTextSchema.optional(),
      content_kind: z.literal("untrusted_business_data"),
    })
    .strict(),
  z
    .object({
      ...BaseCardShape,
      source: z.literal("financial_document"),
      document_ref: z
        .object({
          kind: z.enum(["estimate", "invoice"]),
          id: P2CanonicalUuidSchema,
        })
        .strict(),
      job_ref: JobRefSchema.optional(),
      reason: z.enum([
        "invoice_overdue",
        "invoice_due",
        "estimate_expired",
        "estimate_approval_pending",
      ]),
      document_number: createP2CanonicalTextSchema({
        minimumScalars: 1,
        maximumScalars: 256,
        maximumUtf8Bytes: 1_024,
        allowTextWhitespace: true,
      }),
      content_kind: z.literal("untrusted_business_data"),
    })
    .strict(),
  z
    .object({
      ...BaseCardShape,
      source: z.literal("payment"),
      payment_ref: z
        .object({ kind: z.literal("payment"), id: P2CanonicalUuidSchema })
        .strict(),
      reason: z.literal("reconciliation_required"),
    })
    .strict(),
  z
    .object({
      ...BaseCardShape,
      source: z.literal("expense"),
      expense_ref: z
        .object({
          kind: z.enum(["expense", "reimbursement_batch"]),
          id: P2CanonicalUuidSchema,
        })
        .strict(),
      reason: z.enum(["approval_required", "reimbursement_pending"]),
    })
    .strict(),
]);

export const WorkQueueWarningSchema = z
  .object({
    code: z.literal("DEFAULT_COMPONENT_OMITTED"),
    source: WorkQueueSourceSchema,
  })
  .strict();
export const WorkQueueCollectionProofSchema = z
  .object({
    proof_ref: P2ProofRefSchema,
    read_at: P2CanonicalTimestampSchema,
    source_revisions: z
      .array(
        z
          .object({
            domain: z.string().min(1).max(128),
            source_revision: z.number().int().safe().nonnegative(),
          })
          .strict()
      )
      .max(64)
      .refine(
        (values) =>
          values.every(
            (value, index) =>
              index === 0 || values[index - 1]!.domain < value.domain
          ),
        "WORK_QUEUE_REVISION_VECTOR_NOT_CANONICAL"
      ),
    returned_count: z.number().int().min(0).max(WORK_QUEUE_MAX_PAGE_ITEMS),
    has_more: z.boolean(),
  })
  .strict()
  .refine(
    (proof) => !(proof.has_more && proof.returned_count === 0),
    "WORK_QUEUE_EMPTY_COLLECTION_CANNOT_HAVE_MORE"
  );
export const ListWorkQueueResultSchema = z
  .object({
    items: z.array(WorkQueueCardSchema).max(WORK_QUEUE_MAX_PAGE_ITEMS),
    item_proofs: z.array(P2EntityProofSchema).max(WORK_QUEUE_MAX_PAGE_ITEMS),
    evidence: z.array(P2EvidenceIdentitySchema).max(WORK_QUEUE_MAX_PAGE_ITEMS),
    warnings: z.array(WorkQueueWarningSchema).max(WORK_QUEUE_SOURCES.length),
    collection_proof: WorkQueueCollectionProofSchema,
    next_cursor: WorkQueueCursorTokenSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    const sourceRank = new Map(
      WORK_QUEUE_SOURCES.map((source, index) => [source, index])
    );
    const expectedPriority = (item: z.infer<typeof WorkQueueCardSchema>) => {
      if (item.source === "task") return item.reason === "overdue" ? 0 : 2;
      if (item.source === "lead")
        return item.reason === "operator_action_required" ? 0 : 1;
      if (item.source === "match_review") return 0;
      if (item.source === "financial_document")
        return item.reason === "invoice_overdue" ? 0 : 2;
      if (item.source === "expense")
        return item.reason === "approval_required" ? 1 : 2;
      if (item.source === "schedule") return 2;
      return 1;
    };
    const ordered = result.items.every((item, index) => {
      const authorityId =
        item.source === "task" || item.source === "schedule"
          ? item.task_ref.id
          : item.source === "lead"
            ? item.job_ref.id
            : item.source === "correspondence" || item.source === "commitment"
              ? item.thread_ref.id
              : item.source === "match_review"
                ? item.activity_ref.id
                : item.source === "financial_document"
                  ? item.document_ref.id
                  : item.source === "payment"
                    ? item.payment_ref.id
                    : item.expense_ref.id;
      if (
        item.queue_ref.kind !== item.source ||
        item.queue_ref.id !== authorityId ||
        item.priority !== expectedPriority(item)
      )
        return false;
      if (index === 0) return true;
      const previous = result.items[index - 1]!;
      return (
        previous.priority < item.priority ||
        (previous.priority === item.priority &&
          (previous.attention_at < item.attention_at ||
            (previous.attention_at === item.attention_at &&
              (previous.source < item.source ||
                (previous.source === item.source &&
                  previous.queue_ref.id < item.queue_ref.id)))))
      );
    });
    const warningsCanonical = result.warnings.every(
      (warning, index) =>
        index === 0 ||
        sourceRank.get(result.warnings[index - 1]!.source)! <
          sourceRank.get(warning.source)!
    );
    const proofCoupled =
      result.item_proofs.length === result.items.length &&
      result.evidence.length === result.items.length &&
      result.item_proofs.every(
        (proof) => proof.read_at === result.collection_proof.read_at
      ) &&
      result.evidence.every(
        (evidence, index) =>
          evidence.occurred_at === result.collection_proof.read_at &&
          evidence.source_domain === "work_queue" &&
          evidence.source_type === result.items[index]!.source
      );
    const queueIdentities = result.items.map(
      (item) => `${item.queue_ref.kind}:${item.queue_ref.id}`
    );
    const proofIdentities = result.item_proofs.map((proof) => proof.proof_ref);
    const evidenceIdentities = result.evidence.map(
      (evidence) => evidence.evidence_ref
    );
    if (
      !ordered ||
      !warningsCanonical ||
      new Set(result.warnings.map(({ source }) => source)).size !==
        result.warnings.length ||
      result.warnings.some(({ source }) =>
        result.items.some((item) => item.source === source)
      ) ||
      !proofCoupled ||
      result.collection_proof.returned_count !== result.items.length ||
      result.collection_proof.has_more !== (result.next_cursor !== null) ||
      new Set(queueIdentities).size !== queueIdentities.length ||
      new Set(proofIdentities).size !== proofIdentities.length ||
      new Set(evidenceIdentities).size !== evidenceIdentities.length ||
      (result.collection_proof.source_revisions.length === 0 &&
        (result.items.length !== 0 ||
          result.warnings.length !== WORK_QUEUE_SOURCES.length))
    ) {
      context.addIssue({
        code: "custom",
        message: "WORK_QUEUE_RESULT_INVALID",
      });
    }
  });

export type WorkQueueSource = z.infer<typeof WorkQueueSourceSchema>;
export type WorkQueueSelection = Readonly<{
  source: WorkQueueSource;
  origin: "explicit" | "default";
}>;
export type ListWorkQueueInput = z.infer<typeof ListWorkQueueInputSchema>;
export type WorkQueueCard = z.infer<typeof WorkQueueCardSchema>;
export type ListWorkQueueResult = z.infer<typeof ListWorkQueueResultSchema>;
export type WorkQueueRevisionVector = z.infer<
  typeof P2DomainRevisionVectorSchema
>;

export function assertNoWorkQueueForbiddenFields(value: unknown): void {
  assertP2NoForbiddenFields(value);
}
