import "server-only";

import { z } from "zod-v4";

import {
  createP2CanonicalTextSchema,
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  SourceVersionSchema,
  type P2DomainRevision,
  type SourceVersion,
} from "@/lib/agent-control-plane/contracts";
import { canonicalizeP2DomainRevisions } from "./domain-revisions";
import { P2_LEGACY_ATTENTION_PROJECTIONS } from "./private-projection-contracts";

const DISPLAY_TEXT = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 256,
  maximumUtf8Bytes: 1_024,
});
const SUBJECT_TEXT = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 512,
  maximumUtf8Bytes: 2_048,
});
const SNIPPET_TEXT = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 1_000,
  maximumUtf8Bytes: 4_000,
  allowTextWhitespace: true,
});
const OPPORTUNITY_REF = z
  .object({ kind: z.literal("opportunity"), id: P2CanonicalUuidSchema })
  .strict();
const PROJECT_REF = z
  .object({ kind: z.literal("project"), id: P2CanonicalUuidSchema })
  .strict();

const LEAD_CARD = z
  .object({
    card_kind: z.literal("lead"),
    job_ref: OPPORTUNITY_REF,
    title: DISPLAY_TEXT.nullable(),
    reason_code: z.enum(["follow_up_due", "operator_action_required"]),
    attention_at: P2CanonicalTimestampSchema,
  })
  .strict();
const CORRESPONDENCE_CARD = z
  .object({
    card_kind: z.literal("correspondence"),
    thread_ref: P2CanonicalUuidSchema,
    job_ref: OPPORTUNITY_REF,
    subject: SUBJECT_TEXT.nullable(),
    latest_snippet: SNIPPET_TEXT.nullable(),
    reason_code: z.enum(["unresolved_commitment", "match_needs_review"]),
    attention_at: P2CanonicalTimestampSchema,
    unread_count: z.number().int().safe().nonnegative(),
  })
  .strict();
const SCHEDULE_CARD = z
  .object({
    card_kind: z.literal("schedule"),
    task_ref: P2CanonicalUuidSchema,
    job_ref: PROJECT_REF,
    title: DISPLAY_TEXT.nullable(),
    reason_code: z.enum(["confirmation_required", "starts_soon"]),
    attention_at: P2CanonicalTimestampSchema,
    ends_at: P2CanonicalTimestampSchema.nullable(),
    confirmation_state: z.enum(["confirmed", "unconfirmed"]),
  })
  .strict();

function envelope<TCard extends z.ZodType>(
  revision: string,
  card: TCard,
  orderKey: (
    cardValue: z.output<TCard>
  ) => readonly [attentionAt: string, primaryRef: string]
) {
  return z
    .object({
      projection_revision: z.literal(revision),
      read_at: P2CanonicalTimestampSchema,
      source_versions: z.array(SourceVersionSchema).min(1).max(3),
      source_inspected_count: z.number().int().safe().min(0).max(500),
      returned_count: z.number().int().min(0).max(25),
      has_more: z.boolean(),
      cards: z.array(card).max(25),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.returned_count !== value.cards.length ||
        value.source_inspected_count < value.returned_count ||
        value.has_more !== value.source_inspected_count > value.returned_count
      ) {
        context.addIssue({
          code: "custom",
          message: "P2_LEGACY_ATTENTION_COUNTS_INVALID",
        });
      }

      const seenPrimaryRefs = new Set<string>();
      let previousKey:
        | readonly [attentionAt: string, primaryRef: string]
        | null = null;
      for (const [index, cardValue] of value.cards.entries()) {
        const currentKey = orderKey(cardValue);
        const [attentionAt, primaryRef] = currentKey;
        if (seenPrimaryRefs.has(primaryRef)) {
          context.addIssue({
            code: "custom",
            message: "P2_LEGACY_ATTENTION_PRIMARY_REF_DUPLICATE",
            path: ["cards", index],
          });
        }
        seenPrimaryRefs.add(primaryRef);

        if (
          previousKey !== null &&
          (attentionAt < previousKey[0] ||
            (attentionAt === previousKey[0] && primaryRef <= previousKey[1]))
        ) {
          context.addIssue({
            code: "custom",
            message: "P2_LEGACY_ATTENTION_ORDER_INVALID",
            path: ["cards", index],
          });
        }
        previousKey = currentKey;
      }
    });
}

const LEAD_ENVELOPE = envelope(
  P2_LEGACY_ATTENTION_PROJECTIONS.lead.projectionRevision,
  LEAD_CARD,
  (card) => [card.attention_at, card.job_ref.id]
);
const CORRESPONDENCE_ENVELOPE = envelope(
  P2_LEGACY_ATTENTION_PROJECTIONS.correspondence.projectionRevision,
  CORRESPONDENCE_CARD,
  (card) => [card.attention_at, card.thread_ref]
);
const SCHEDULE_ENVELOPE = envelope(
  P2_LEGACY_ATTENTION_PROJECTIONS.schedule.projectionRevision,
  SCHEDULE_CARD,
  (card) => [card.attention_at, card.task_ref]
);

export class P2LegacyAttentionProjectionError extends Error {
  readonly code = "P2_LEGACY_ATTENTION_PROJECTION_INVALID" as const;

  constructor() {
    super("P2_LEGACY_ATTENTION_PROJECTION_INVALID");
    this.name = "P2LegacyAttentionProjectionError";
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function withCanonicalRevisions<
  TEnvelope extends Readonly<{ source_versions: readonly SourceVersion[] }>,
>(
  parsed: TEnvelope,
  expectedRevisionFamilies: readonly string[]
): Readonly<TEnvelope & { source_revisions: readonly P2DomainRevision[] }> {
  try {
    if (parsed.source_versions.length !== expectedRevisionFamilies.length) {
      throw new P2LegacyAttentionProjectionError();
    }
    const sourceRevisions = canonicalizeP2DomainRevisions(
      parsed.source_versions
    );
    const families = sourceRevisions.map((revision) => revision.domain);
    if (
      families.length !== expectedRevisionFamilies.length ||
      families.some(
        (family, index) => family !== expectedRevisionFamilies[index]
      )
    ) {
      throw new P2LegacyAttentionProjectionError();
    }
    return deepFreeze({
      ...parsed,
      source_revisions: sourceRevisions,
    });
  } catch (error) {
    if (error instanceof P2LegacyAttentionProjectionError) throw error;
    throw new P2LegacyAttentionProjectionError();
  }
}

export function parseP2LegacyLeadAttention(raw: unknown) {
  const parsed = LEAD_ENVELOPE.safeParse(raw);
  if (!parsed.success) throw new P2LegacyAttentionProjectionError();
  return withCanonicalRevisions(
    parsed.data,
    P2_LEGACY_ATTENTION_PROJECTIONS.lead.revisionFamilies
  );
}

export function parseP2LegacyCorrespondenceAttention(raw: unknown) {
  const parsed = CORRESPONDENCE_ENVELOPE.safeParse(raw);
  if (!parsed.success) throw new P2LegacyAttentionProjectionError();
  return withCanonicalRevisions(
    parsed.data,
    P2_LEGACY_ATTENTION_PROJECTIONS.correspondence.revisionFamilies
  );
}

export function parseP2LegacyScheduleAttention(raw: unknown) {
  const parsed = SCHEDULE_ENVELOPE.safeParse(raw);
  if (!parsed.success) throw new P2LegacyAttentionProjectionError();
  return withCanonicalRevisions(
    parsed.data,
    P2_LEGACY_ATTENTION_PROJECTIONS.schedule.revisionFamilies
  );
}
