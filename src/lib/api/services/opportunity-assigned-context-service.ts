import { z } from "zod";

import { getSupabaseClient } from "@/lib/supabase/client";
import {
  ActivityType,
  EstimateStatus,
  FollowUpStatus,
  FollowUpType,
  OpportunityPriority,
  OpportunitySource,
  OpportunityStage,
  SiteVisitStatus,
} from "@/lib/types/pipeline";

const RPC_NAME = "get_opportunity_assigned_context";

const uuidSchema = z.string().uuid();
const timestampSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const nullableTimestampSchema = timestampSchema.nullable();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const leadSchema = z
  .object({
    id: uuidSchema,
    title: z.string(),
    description: z.string().nullable(),
    stage: z.nativeEnum(OpportunityStage),
    priority: z.nativeEnum(OpportunityPriority).nullable(),
    estimated_value: z.number().finite().nullable(),
    expected_close_date: dateSchema.nullable(),
    source: z.nativeEnum(OpportunitySource).nullable(),
    tags: z.array(z.string()),
    address: z.string().nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict()
  .transform((value) => ({
    id: value.id,
    title: value.title,
    description: value.description,
    stage: value.stage,
    priority: value.priority,
    estimatedValue: value.estimated_value,
    expectedCloseDate: value.expected_close_date,
    source: value.source,
    tags: value.tags,
    address: value.address,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  }));

const contactSchema = z
  .object({
    id: uuidSchema.nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    profile_image_url: z.string().nullable(),
  })
  .strict()
  .transform((value) => ({
    id: value.id,
    name: value.name,
    email: value.email,
    phone: value.phone,
    address: value.address,
    profileImageUrl: value.profile_image_url,
  }));

const estimateSummarySchema = z
  .object({
    id: uuidSchema,
    estimate_number: z.string(),
    title: z.string().nullable(),
    status: z.nativeEnum(EstimateStatus),
    subtotal: z.number().finite(),
    tax_amount: z.number().finite(),
    total: z.number().finite(),
    issue_date: dateSchema,
    expiration_date: dateSchema.nullable(),
    sent_at: nullableTimestampSchema,
    approved_at: nullableTimestampSchema,
  })
  .strict()
  .transform((value) => ({
    id: value.id,
    estimateNumber: value.estimate_number,
    title: value.title,
    status: value.status,
    subtotal: value.subtotal,
    taxAmount: value.tax_amount,
    total: value.total,
    issueDate: value.issue_date,
    expirationDate: value.expiration_date,
    sentAt: value.sent_at,
    approvedAt: value.approved_at,
  }));

const activitySchema = z
  .object({
    id: uuidSchema,
    type: z.nativeEnum(ActivityType),
    subject: z.string(),
    content: z.string().nullable(),
    body_text: z.string().nullable(),
    direction: z.enum(["inbound", "outbound"]).nullable(),
    outcome: z.string().nullable(),
    duration_minutes: z.number().int().nonnegative().nullable(),
    has_attachments: z.boolean(),
    created_at: timestampSchema,
  })
  .strict()
  .transform((value) => ({
    id: value.id,
    type: value.type,
    subject: value.subject,
    content: value.content,
    bodyText: value.body_text,
    direction: value.direction,
    outcome: value.outcome,
    durationMinutes: value.duration_minutes,
    hasAttachments: value.has_attachments,
    createdAt: value.created_at,
  }));

const followUpSchema = z
  .object({
    id: uuidSchema,
    title: z.string(),
    description: z.string().nullable(),
    type: z.nativeEnum(FollowUpType),
    status: z.nativeEnum(FollowUpStatus),
    due_at: timestampSchema,
    reminder_at: nullableTimestampSchema,
    completed_at: nullableTimestampSchema,
    completion_notes: z.string().nullable(),
    assigned_to: uuidSchema.nullable(),
    created_at: timestampSchema,
  })
  .strict()
  .transform((value) => ({
    id: value.id,
    title: value.title,
    description: value.description,
    type: value.type,
    status: value.status,
    dueAt: value.due_at,
    reminderAt: value.reminder_at,
    completedAt: value.completed_at,
    completionNotes: value.completion_notes,
    assignedTo: value.assigned_to,
    createdAt: value.created_at,
  }));

const siteVisitSchema = z
  .object({
    id: uuidSchema,
    scheduled_at: timestampSchema,
    duration_minutes: z.number().int().nonnegative(),
    status: z.nativeEnum(SiteVisitStatus),
    notes: z.string().nullable(),
    internal_notes: z.string().nullable(),
    measurements: z.string().nullable(),
    photos: z.array(z.string()),
    completed_at: nullableTimestampSchema,
  })
  .strict()
  .transform((value) => ({
    id: value.id,
    scheduledAt: value.scheduled_at,
    durationMinutes: value.duration_minutes,
    status: value.status,
    notes: value.notes,
    internalNotes: value.internal_notes,
    measurements: value.measurements,
    photos: value.photos,
    completedAt: value.completed_at,
  }));

const deckDesignSchema = z
  .object({
    id: uuidSchema,
    title: z.string(),
    thumbnail_url: z.string().nullable(),
    version: z.number().int().nonnegative(),
    updated_at: nullableTimestampSchema,
  })
  .strict()
  .transform((value) => ({
    id: value.id,
    title: value.title,
    thumbnailUrl: value.thumbnail_url,
    version: value.version,
    updatedAt: value.updated_at,
  }));

const lifecycleSchema = z
  .object({
    last_meaningful_at: nullableTimestampSchema,
    last_meaningful_direction: z.enum(["inbound", "outbound"]).nullable(),
    unanswered_follow_up_count: z.number().int().nonnegative(),
    stale_status: z.string().nullable(),
    stale_status_at: nullableTimestampSchema,
    protected_until: nullableTimestampSchema,
    updated_at: timestampSchema,
  })
  .strict()
  .transform((value) => ({
    lastMeaningfulAt: value.last_meaningful_at,
    lastMeaningfulDirection: value.last_meaningful_direction,
    unansweredFollowUpCount: value.unanswered_follow_up_count,
    staleStatus: value.stale_status,
    staleStatusAt: value.stale_status_at,
    protectedUntil: value.protected_until,
    updatedAt: value.updated_at,
  }));

const correspondenceSchema = z
  .object({
    id: uuidSchema,
    direction: z.enum(["inbound", "outbound"]),
    party_role: z.enum([
      "customer",
      "ops",
      "internal",
      "provider",
      "system",
      "marketing",
      "unknown",
    ]),
    is_meaningful: z.boolean(),
    noise_reason: z.string().nullable(),
    subject: z.string().nullable(),
    occurred_at: timestampSchema,
  })
  .strict()
  .transform((value) => ({
    id: value.id,
    direction: value.direction,
    partyRole: value.party_role,
    isMeaningful: value.is_meaningful,
    noiseReason: value.noise_reason,
    subject: value.subject,
    occurredAt: value.occurred_at,
  }));

const assignedContextSchema = z
  .object({
    lead: leadSchema,
    contact: contactSchema,
    estimate_summaries: z.array(estimateSummarySchema),
    activities: z.array(activitySchema),
    follow_ups: z.array(followUpSchema),
    site_visits: z.array(siteVisitSchema),
    deck_designs: z.array(deckDesignSchema),
    lifecycle: lifecycleSchema.nullable(),
    correspondence: z.array(correspondenceSchema),
  })
  .strict()
  .transform((value) => ({
    lead: value.lead,
    contact: value.contact,
    estimateSummaries: value.estimate_summaries,
    activities: value.activities,
    followUps: value.follow_ups,
    siteVisits: value.site_visits,
    deckDesigns: value.deck_designs,
    lifecycle: value.lifecycle,
    correspondence: value.correspondence,
  }));

export type OpportunityAssignedContext = z.infer<typeof assignedContextSchema>;
export type OpportunityAssignedContextLead = OpportunityAssignedContext["lead"];
export type OpportunityAssignedContextContact =
  OpportunityAssignedContext["contact"];
export type OpportunityAssignedContextEstimate =
  OpportunityAssignedContext["estimateSummaries"][number];
export type OpportunityAssignedContextActivity =
  OpportunityAssignedContext["activities"][number];
export type OpportunityAssignedContextFollowUp =
  OpportunityAssignedContext["followUps"][number];
export type OpportunityAssignedContextSiteVisit =
  OpportunityAssignedContext["siteVisits"][number];
export type OpportunityAssignedContextCorrespondence =
  OpportunityAssignedContext["correspondence"][number];

export type OpportunityAssignedContextErrorCode =
  | "invalid_request"
  | "client_unavailable"
  | "access_denied"
  | "rpc_error"
  | "invalid_response";

export class OpportunityAssignedContextError extends Error {
  constructor(
    readonly code: OpportunityAssignedContextErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OpportunityAssignedContextError";
  }
}

async function fetchAssignedContext(
  opportunityId: string
): Promise<OpportunityAssignedContext> {
  if (!uuidSchema.safeParse(opportunityId).success) {
    throw new OpportunityAssignedContextError(
      "invalid_request",
      "Invalid opportunity id"
    );
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new OpportunityAssignedContextError(
      "client_unavailable",
      "Supabase client unavailable"
    );
  }

  const { data, error } = await supabase.rpc(RPC_NAME, {
    p_opportunity_id: opportunityId,
  });

  if (error) {
    const denied =
      error.code === "42501" ||
      error.message.toLowerCase().includes("access_denied");
    throw new OpportunityAssignedContextError(
      denied ? "access_denied" : "rpc_error",
      denied
        ? "Opportunity context access denied"
        : "Opportunity context read failed"
    );
  }

  const parsed = assignedContextSchema.safeParse(data);
  if (!parsed.success || parsed.data.lead.id !== opportunityId) {
    throw new OpportunityAssignedContextError(
      "invalid_response",
      "Opportunity context response was invalid"
    );
  }

  return parsed.data;
}

export const OpportunityAssignedContextService = {
  fetch: fetchAssignedContext,
};
