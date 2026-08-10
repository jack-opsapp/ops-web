import { z } from "zod";

const UuidSchema = z.string().uuid();

const LogicalJobRefSchema = z
  .object({
    kind: z.enum(["opportunity", "project"]),
    id: UuidSchema,
    company_id: UuidSchema,
    conversation_id: UuidSchema,
    resolved_customer_id: UuidSchema,
  })
  .strict();

export const CrossJobSeedStatusSchema = z.enum([
  "active",
  "scheduled",
  "in_progress",
  "completed",
  "closed",
  "cancelled",
  "converted",
  "archived",
]);

const ContinuityEvidenceSchema = z
  .object({
    source_type: z.literal("job_conversation"),
    source_entity_id: UuidSchema,
  })
  .strict();

const VisiblePriorJobSchema = z
  .object({
    job: LogicalJobRefSchema,
    lifecycle: z.enum(["active", "completed"]),
    visible_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: CrossJobSeedStatusSchema,
    continuity_evidence: ContinuityEvidenceSchema.nullable(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (
      candidate.continuity_evidence !== null &&
      candidate.continuity_evidence.source_entity_id !==
        candidate.job.conversation_id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Continuity evidence must identify the logical job conversation",
        path: ["continuity_evidence", "source_entity_id"],
      });
    }
  });

const CrossJobSeedInputSchema = z
  .object({
    current_job: LogicalJobRefSchema,
    actor_visible_jobs: z.array(VisiblePriorJobSchema).max(1_000),
  })
  .strict()
  .superRefine((input, context) => {
    input.actor_visible_jobs.forEach((candidate, index) => {
      if (candidate.job.company_id !== input.current_job.company_id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Visible job company does not match the current job company",
          path: ["actor_visible_jobs", index, "job", "company_id"],
        });
      }
    });
  });

export type CrossJobSeedStatus = z.infer<typeof CrossJobSeedStatusSchema>;
type VisiblePriorJob = z.infer<typeof VisiblePriorJobSchema>;

interface CanonicalPriorJob {
  readonly representative: VisiblePriorJob;
  readonly hasContinuityEvidence: boolean;
}

export interface CrossJobSeed {
  readonly customer_has_prior_ops_jobs: boolean;
  readonly visible_prior_job_count: number;
  readonly latest_visible_prior_job: {
    readonly date: string;
    readonly status: CrossJobSeedStatus;
  } | null;
  readonly relationship_continuity: {
    readonly marker: "returning_customer";
    readonly evidence_id: string;
  } | null;
}

export function buildCrossJobSeed(input: unknown): CrossJobSeed {
  const parsed = CrossJobSeedInputSchema.parse(input);
  const byConversation = new Map<string, CanonicalPriorJob>();

  for (const candidate of parsed.actor_visible_jobs) {
    if (
      candidate.job.resolved_customer_id !==
        parsed.current_job.resolved_customer_id ||
      candidate.job.conversation_id === parsed.current_job.conversation_id
    ) {
      continue;
    }

    const conversationId = candidate.job.conversation_id;
    const existing = byConversation.get(conversationId);
    if (!existing) {
      byConversation.set(conversationId, {
        representative: candidate,
        hasContinuityEvidence: candidate.continuity_evidence !== null,
      });
      continue;
    }

    byConversation.set(conversationId, {
      representative:
        compareCanonicalRepresentative(candidate, existing.representative) < 0
          ? candidate
          : existing.representative,
      hasContinuityEvidence:
        existing.hasContinuityEvidence ||
        candidate.continuity_evidence !== null,
    });
  }

  const prior = [...byConversation.values()].sort((left, right) => {
    const date = compareText(
      right.representative.visible_date,
      left.representative.visible_date
    );
    if (date !== 0) return date;
    return compareText(
      left.representative.job.conversation_id,
      right.representative.job.conversation_id
    );
  });
  const latest = prior[0] ?? null;
  const continuity = prior.find((candidate) => candidate.hasContinuityEvidence);

  return Object.freeze({
    customer_has_prior_ops_jobs: prior.length > 0,
    visible_prior_job_count: prior.length,
    latest_visible_prior_job: latest
      ? Object.freeze({
          date: latest.representative.visible_date,
          status: latest.representative.status,
        })
      : null,
    relationship_continuity: continuity
      ? Object.freeze({
          marker: "returning_customer" as const,
          evidence_id: `job_conversation:${continuity.representative.job.conversation_id}`,
        })
      : null,
  });
}

function compareCanonicalRepresentative(
  left: VisiblePriorJob,
  right: VisiblePriorJob
): number {
  if (left.job.kind !== right.job.kind) {
    return left.job.kind === "project" ? -1 : 1;
  }
  const date = compareText(right.visible_date, left.visible_date);
  if (date !== 0) return date;
  const id = compareText(left.job.id, right.job.id);
  if (id !== 0) return id;
  return compareText(left.status, right.status);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
