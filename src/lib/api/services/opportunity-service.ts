/**
 * OPS Web - Opportunity Service
 *
 * Complete CRUD operations for Pipeline Opportunities using Supabase.
 * Includes management of Activities, Follow-Ups, and Stage Transitions.
 *
 * All queries filter out soft-deleted items (deleted_at IS NULL) by default.
 * Database columns use snake_case; TypeScript uses camelCase. Conversion
 * happens at the mapping layer in this file.
 */

import {
  requireSupabase,
  parseDate,
  parseDateRequired,
} from "@/lib/supabase/helpers";
import type {
  Opportunity,
  CreateOpportunity,
  UpdateOpportunity,
  Activity,
  CreateActivity,
  FollowUp,
  CreateFollowUp,
  StageTransition,
  PipelineStageConfig,
} from "@/lib/types/pipeline";
import {
  OpportunityStage,
  FollowUpStatus,
  FollowUpType,
  PIPELINE_STAGES_DEFAULT,
} from "@/lib/types/pipeline";
import { mergeImageUrls, removeImageUrl } from "@/lib/utils/opportunity-images";

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchOpportunitiesOptions {
  /** Filter by a single stage */
  stage?: OpportunityStage;
  /** Filter by multiple stages */
  stages?: OpportunityStage[];
  /** Filter by assigned user */
  assignedTo?: string;
  /** Filter by client ID */
  clientId?: string;
  /** Include soft-deleted opportunities */
  includeDeleted?: boolean;
  /** Include archived opportunities */
  includeArchived?: boolean;
  /** Sort field (snake_case column name) */
  sortField?: string;
  /** Sort direction – true for descending */
  descending?: boolean;
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

/**
 * Convert a snake_case database row into a camelCase Opportunity object.
 */
function mapOpportunityFromDb(row: Record<string, unknown>): Opportunity {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    clientId: (row.client_id as string) ?? null,
    title: row.title as string,
    description: (row.description as string) ?? null,

    // Contact
    contactName: (row.contact_name as string) ?? null,
    contactEmail: (row.contact_email as string) ?? null,
    contactPhone: (row.contact_phone as string) ?? null,

    // Pipeline tracking
    stage: row.stage as OpportunityStage,
    source: (row.source as Opportunity["source"]) ?? null,
    assignedTo: (row.assigned_to as string) ?? null,
    priority: (row.priority as Opportunity["priority"]) ?? null,

    // Financial
    estimatedValue:
      row.estimated_value != null ? Number(row.estimated_value) : null,
    actualValue: row.actual_value != null ? Number(row.actual_value) : null,
    winProbability: Number(row.win_probability ?? 0),

    // Dates
    expectedCloseDate: parseDate(row.expected_close_date),
    actualCloseDate: parseDate(row.actual_close_date),
    stageEnteredAt: parseDateRequired(row.stage_entered_at),

    // Conversion
    projectId: (row.project_id as string) ?? null,
    lostReason: (row.lost_reason as string) ?? null,
    lostNotes: (row.lost_notes as string) ?? null,
    sourceEmailId: (row.source_email_id as string) ?? null,

    // Email correspondence tracking
    correspondenceCount: Number(row.correspondence_count ?? 0),
    outboundCount: Number(row.outbound_count ?? 0),
    inboundCount: Number(row.inbound_count ?? 0),
    lastInboundAt: parseDate(row.last_inbound_at),
    lastOutboundAt: parseDate(row.last_outbound_at),
    lastMessageDirection: (row.last_message_direction as "in" | "out") ?? null,

    // AI analysis
    aiSummary: (row.ai_summary as string) ?? null,
    aiStageConfidence:
      row.ai_stage_confidence != null ? Number(row.ai_stage_confidence) : null,
    aiStageSignals: (row.ai_stage_signals as string[]) ?? null,
    detectedValue:
      row.detected_value != null ? Number(row.detected_value) : null,

    // Quote delivery
    quoteDeliveryMethod:
      (row.quote_delivery_method as Opportunity["quoteDeliveryMethod"]) ?? null,

    // Address
    address: (row.address as string) ?? null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,

    // Denormalized
    lastActivityAt: parseDate(row.last_activity_at),
    nextFollowUpAt: parseDate(row.next_follow_up_at),
    tags: (row.tags as string[]) ?? [],
    images: (row.images as string[]) ?? [],

    // System
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
    archivedAt: row.archived_at ? parseDate(row.archived_at) : null,
  };
}

/**
 * Convert a camelCase create/update payload into a snake_case database row.
 * Only includes keys that are present in the source object.
 */
function mapOpportunityToDb(
  data: Partial<CreateOpportunity> & { nextFollowUpAt?: Date | string | null }
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.clientId !== undefined) row.client_id = data.clientId;
  if (data.title !== undefined) row.title = data.title;
  if (data.description !== undefined) row.description = data.description;

  // Contact
  if (data.contactName !== undefined) row.contact_name = data.contactName;
  if (data.contactEmail !== undefined) row.contact_email = data.contactEmail;
  if (data.contactPhone !== undefined) row.contact_phone = data.contactPhone;

  // Pipeline tracking
  if (data.stage !== undefined) row.stage = data.stage;
  if (data.source !== undefined) row.source = data.source;
  if (data.assignedTo !== undefined) row.assigned_to = data.assignedTo;
  if (data.priority !== undefined) row.priority = data.priority;

  // Financial
  if (data.estimatedValue !== undefined)
    row.estimated_value = data.estimatedValue;
  if (data.actualValue !== undefined) row.actual_value = data.actualValue;
  if (data.winProbability !== undefined)
    row.win_probability = data.winProbability;

  // Dates
  if (data.expectedCloseDate !== undefined) {
    row.expected_close_date = data.expectedCloseDate
      ? data.expectedCloseDate instanceof Date
        ? data.expectedCloseDate.toISOString()
        : data.expectedCloseDate
      : null;
  }
  if (data.actualCloseDate !== undefined) {
    row.actual_close_date = data.actualCloseDate
      ? data.actualCloseDate instanceof Date
        ? data.actualCloseDate.toISOString()
        : data.actualCloseDate
      : null;
  }
  // Denormalized next-follow-up timestamp. Normally server-derived, but
  // update flows (e.g. the pipeline table inline edit) may set it directly;
  // the column has no trigger maintaining it, so a direct write is authoritative.
  if (data.nextFollowUpAt !== undefined) {
    row.next_follow_up_at = data.nextFollowUpAt
      ? data.nextFollowUpAt instanceof Date
        ? data.nextFollowUpAt.toISOString()
        : data.nextFollowUpAt
      : null;
  }

  // Conversion
  if (data.projectId !== undefined) row.project_id = data.projectId;
  if (data.lostReason !== undefined) row.lost_reason = data.lostReason;
  if (data.lostNotes !== undefined) row.lost_notes = data.lostNotes;
  if (data.sourceEmailId !== undefined)
    row.source_email_id = data.sourceEmailId;
  if (data.sourceThreadKey !== undefined)
    row.source_thread_key = data.sourceThreadKey;

  // Email correspondence tracking
  if (data.correspondenceCount !== undefined)
    row.correspondence_count = data.correspondenceCount;
  if (data.outboundCount !== undefined) row.outbound_count = data.outboundCount;
  if (data.inboundCount !== undefined) row.inbound_count = data.inboundCount;
  if (data.lastInboundAt !== undefined) {
    row.last_inbound_at = data.lastInboundAt
      ? data.lastInboundAt instanceof Date
        ? data.lastInboundAt.toISOString()
        : data.lastInboundAt
      : null;
  }
  if (data.lastOutboundAt !== undefined) {
    row.last_outbound_at = data.lastOutboundAt
      ? data.lastOutboundAt instanceof Date
        ? data.lastOutboundAt.toISOString()
        : data.lastOutboundAt
      : null;
  }
  if (data.lastMessageDirection !== undefined)
    row.last_message_direction = data.lastMessageDirection;

  // Quote delivery
  if (data.quoteDeliveryMethod !== undefined)
    row.quote_delivery_method = data.quoteDeliveryMethod;

  // Address
  if (data.address !== undefined) row.address = data.address;
  if (data.latitude !== undefined) row.latitude = data.latitude;
  if (data.longitude !== undefined) row.longitude = data.longitude;

  // Tags
  if (data.tags !== undefined) row.tags = data.tags;

  return row;
}

/**
 * Convert a snake_case database row into a camelCase Activity object.
 *
 * Reads the email-extended columns (to_emails, cc_emails, body_text,
 * has_attachments, attachment_count, match_confidence, match_needs_review,
 * suggested_client_id) that the sync-engine writes directly. Without them,
 * the inbox-leads review queue can't drive its needs-review pill and the
 * activity-detail UI can't show thread bodies.
 */
function mapActivityFromDb(row: Record<string, unknown>): Activity {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    opportunityId: (row.opportunity_id as string) ?? null,
    clientId: (row.client_id as string) ?? null,
    estimateId: (row.estimate_id as string) ?? null,
    invoiceId: (row.invoice_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    siteVisitId: (row.site_visit_id as string) ?? null,

    type: row.type as Activity["type"],
    subject: row.subject as string,
    content: (row.content as string) ?? null,
    outcome: (row.outcome as string) ?? null,
    direction: (row.direction as Activity["direction"]) ?? null,
    durationMinutes:
      row.duration_minutes != null ? Number(row.duration_minutes) : null,
    attachments: (row.attachments as string[]) ?? [],
    emailConnectionId: (row.email_connection_id as string) ?? null,
    emailThreadId: (row.email_thread_id as string) ?? null,
    emailMessageId: (row.email_message_id as string) ?? null,
    isRead: (row.is_read as boolean) ?? true,
    fromEmail: (row.from_email as string) ?? null,

    // Email-extended
    toEmails: (row.to_emails as string[]) ?? [],
    ccEmails: (row.cc_emails as string[]) ?? [],
    bodyText: (row.body_text as string) ?? null,
    hasAttachments: (row.has_attachments as boolean) ?? false,
    attachmentCount:
      row.attachment_count != null ? Number(row.attachment_count) : 0,
    matchConfidence: (row.match_confidence as string) ?? null,
    matchNeedsReview: (row.match_needs_review as boolean) ?? false,
    suggestedClientId: (row.suggested_client_id as string) ?? null,

    createdBy: (row.created_by as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
  };
}

/**
 * Convert a camelCase CreateActivity payload into a snake_case database row.
 *
 * Writes email-extended columns when present so OpportunityService.createActivity
 * stays in parity with the direct INSERTs that sync-engine does. Defaults
 * are array-empty / false / 0 so non-email activities don't need to set them.
 */
function mapActivityToDb(data: CreateActivity): Record<string, unknown> {
  return {
    company_id: data.companyId,
    opportunity_id: data.opportunityId,
    client_id: data.clientId,
    estimate_id: data.estimateId,
    invoice_id: data.invoiceId,
    project_id: data.projectId,
    site_visit_id: data.siteVisitId,
    type: data.type,
    subject: data.subject,
    content: data.content,
    outcome: data.outcome,
    direction: data.direction,
    duration_minutes: data.durationMinutes,
    attachments: data.attachments ?? [],
    email_connection_id: data.emailConnectionId ?? null,
    email_thread_id: data.emailThreadId,
    email_message_id: data.emailMessageId,
    is_read: data.isRead ?? true,
    from_email: data.fromEmail,
    created_by: data.createdBy,
    to_emails: data.toEmails ?? [],
    cc_emails: data.ccEmails ?? [],
    body_text: data.bodyText ?? null,
    has_attachments: data.hasAttachments ?? false,
    attachment_count: data.attachmentCount ?? 0,
    match_confidence: data.matchConfidence ?? null,
    match_needs_review: data.matchNeedsReview ?? false,
    suggested_client_id: data.suggestedClientId ?? null,
    ...(data.occurredAt
      ? {
          created_at:
            data.occurredAt instanceof Date
              ? data.occurredAt.toISOString()
              : data.occurredAt,
        }
      : {}),
  };
}

/**
 * Convert a snake_case database row into a camelCase FollowUp object.
 */
function mapFollowUpFromDb(row: Record<string, unknown>): FollowUp {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    opportunityId: (row.opportunity_id as string) ?? null,
    clientId: (row.client_id as string) ?? null,

    type: row.type as FollowUp["type"],
    title: row.title as string,
    description: (row.description as string) ?? null,
    dueAt: parseDateRequired(row.due_at),
    reminderAt: parseDate(row.reminder_at),
    completedAt: parseDate(row.completed_at),
    assignedTo: (row.assigned_to as string) ?? null,
    status: row.status as FollowUpStatus,
    completionNotes: (row.completion_notes as string) ?? null,
    isAutoGenerated: (row.is_auto_generated as boolean) ?? false,
    triggerSource: (row.trigger_source as string) ?? null,

    createdBy: (row.created_by as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
  };
}

/**
 * Convert a camelCase CreateFollowUp payload into a snake_case database row.
 */
function mapFollowUpToDb(data: CreateFollowUp): Record<string, unknown> {
  return {
    company_id: data.companyId,
    opportunity_id: data.opportunityId,
    client_id: data.clientId,
    type: data.type,
    title: data.title,
    description: data.description,
    due_at: data.dueAt instanceof Date ? data.dueAt.toISOString() : data.dueAt,
    reminder_at: data.reminderAt
      ? data.reminderAt instanceof Date
        ? data.reminderAt.toISOString()
        : data.reminderAt
      : null,
    assigned_to: data.assignedTo,
    status: data.status,
    completion_notes: data.completionNotes,
    is_auto_generated: data.isAutoGenerated,
    trigger_source: data.triggerSource,
    created_by: data.createdBy,
  };
}

/**
 * Convert a snake_case database row into a camelCase StageTransition object.
 */
function mapStageTransitionFromDb(
  row: Record<string, unknown>
): StageTransition {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    opportunityId: row.opportunity_id as string,
    fromStage: (row.from_stage as OpportunityStage) ?? null,
    toStage: row.to_stage as OpportunityStage,
    transitionedAt: parseDateRequired(row.transitioned_at),
    transitionedBy: (row.transitioned_by as string) ?? null,
    durationInStage:
      row.duration_in_stage != null ? Number(row.duration_in_stage) : null,
  };
}

/**
 * Convert a snake_case `pipeline_stage_configs` row into a camelCase
 * PipelineStageConfig object.
 *
 * The DB columns `default_win_probability`, `stale_threshold_days`, and the
 * three `is_*` flags are nullable, but the model fields are not. We coalesce to
 * the table's own column defaults (win probability 10, stale threshold 7, flags
 * false) so a malformed/partial row still produces a valid config rather than
 * propagating nulls into the weighted-forecast / rotting math.
 */
export function mapStageConfigRow(
  row: Record<string, unknown>
): PipelineStageConfig {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    slug: row.slug as string,
    color: row.color as string,
    icon: (row.icon as string) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    isDefault: (row.is_default as boolean) ?? false,
    isWonStage: (row.is_won_stage as boolean) ?? false,
    isLostStage: (row.is_lost_stage as boolean) ?? false,
    defaultWinProbability: Number(row.default_win_probability ?? 10),
    autoFollowUpDays:
      row.auto_follow_up_days != null ? Number(row.auto_follow_up_days) : null,
    autoFollowUpType: (row.auto_follow_up_type as FollowUpType) ?? null,
    staleThresholdDays: Number(row.stale_threshold_days ?? 7),
    createdAt: parseDate(row.created_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

// ─── Opportunity Service ──────────────────────────────────────────────────────

export const OpportunityService = {
  // ─── Opportunities ────────────────────────────────────────────────────────

  /**
   * Fetch all opportunities for a company with optional filters.
   * Automatically filters out soft-deleted items unless includeDeleted is set.
   */
  async fetchOpportunities(
    companyId: string,
    options: FetchOpportunitiesOptions = {}
  ): Promise<Opportunity[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("opportunities")
      .select("*")
      .eq("company_id", companyId);

    // Soft-delete filter
    if (!options.includeDeleted) {
      query = query.is("deleted_at", null);
    }

    // Archive filter
    if (!options.includeArchived) {
      query = query.is("archived_at", null);
    }

    // Single stage filter
    if (options.stage) {
      query = query.eq("stage", options.stage);
    }

    // Multiple stages filter
    if (options.stages && options.stages.length > 0) {
      query = query.in("stage", options.stages);
    }

    // Assigned-to filter
    if (options.assignedTo) {
      query = query.eq("assigned_to", options.assignedTo);
    }

    // Client filter
    if (options.clientId) {
      query = query.eq("client_id", options.clientId);
    }

    // Sorting
    const sortColumn = options.sortField ?? "created_at";
    const ascending =
      options.descending === undefined ? false : !options.descending;
    query = query.order(sortColumn, { ascending });

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch opportunities: ${error.message}`);
    }

    return (data ?? []).map((row) =>
      mapOpportunityFromDb(row as Record<string, unknown>)
    );
  },

  /**
   * Fetch a single opportunity by ID.
   */
  async fetchOpportunity(id: string): Promise<Opportunity> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("opportunities")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      throw new Error(`Failed to fetch opportunity ${id}: ${error.message}`);
    }

    return mapOpportunityFromDb(data as Record<string, unknown>);
  },

  /**
   * Create a new opportunity.
   * Returns the newly created opportunity.
   */
  async createOpportunity(data: CreateOpportunity): Promise<Opportunity> {
    const supabase = requireSupabase();

    const row = mapOpportunityToDb(data);

    const { data: created, error } = await supabase
      .from("opportunities")
      .insert(row)
      .select()
      .single();

    if (error) {
      const createError = new Error(
        `Failed to create opportunity: ${error.message}`,
        { cause: error }
      ) as Error & { code?: string };
      createError.code = (error as { code?: string }).code;
      throw createError;
    }

    return mapOpportunityFromDb(created as Record<string, unknown>);
  },

  /**
   * Update an existing opportunity.
   * Only sends changed fields to minimize payload.
   */
  async updateOpportunity(
    id: string,
    data: Partial<UpdateOpportunity>
  ): Promise<Opportunity> {
    const supabase = requireSupabase();

    // Strip the id field if present – it should not be sent as a column update
    const { id: _id, ...rest } = data as Record<string, unknown>;
    const row = mapOpportunityToDb(
      rest as Partial<CreateOpportunity> & {
        nextFollowUpAt?: Date | string | null;
      }
    );

    const { data: updated, error } = await supabase
      .from("opportunities")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update opportunity ${id}: ${error.message}`);
    }

    return mapOpportunityFromDb(updated as Record<string, unknown>);
  },

  /**
   * Append lead-photo URLs against the SERVER row: fetch → merge → update,
   * mirroring iOS `OpportunityRepository.appendImages` exactly, so a client
   * holding a stale local array can never blow away photos another producer
   * (an iOS device, the email-extract pipeline, another tab) already landed.
   * Duplicate and empty URLs are dropped. Returns the updated opportunity.
   *
   * `images` is deliberately NOT part of `mapOpportunityToDb` — the array is
   * only writable through these two read-modify-write methods.
   */
  async appendImages(id: string, urls: string[]): Promise<Opportunity> {
    const supabase = requireSupabase();

    const current = await this.fetchOpportunity(id);
    const merged = mergeImageUrls(current.images, urls);

    const { data: updated, error } = await supabase
      .from("opportunities")
      .update({ images: merged })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw new Error(
        `Failed to append images to opportunity ${id}: ${error.message}`
      );
    }

    return mapOpportunityFromDb(updated as Record<string, unknown>);
  },

  /**
   * Remove one lead-photo URL — same server-state read-modify-write contract
   * as {@link appendImages}. The S3 object is left in place: `/api/uploads/delete`
   * does not exist, and photo deletion is an array PATCH by design (bible 03
   * § Images contract).
   */
  async removeImage(id: string, url: string): Promise<Opportunity> {
    const supabase = requireSupabase();

    const current = await this.fetchOpportunity(id);
    const remaining = removeImageUrl(current.images, url);

    const { data: updated, error } = await supabase
      .from("opportunities")
      .update({ images: remaining })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw new Error(
        `Failed to remove image from opportunity ${id}: ${error.message}`
      );
    }

    return mapOpportunityFromDb(updated as Record<string, unknown>);
  },

  /**
   * Move an opportunity to a new pipeline stage.
   *
   * This performs three operations atomically:
   *   1. Fetches the current opportunity to get the current stage.
   *   2. Updates the opportunity with the new stage, stage_entered_at, and
   *      win_probability derived from the default stage configuration.
   *   3. Inserts a stage_transitions record with the calculated duration in
   *      the previous stage.
   *
   * Returns the updated opportunity.
   */
  async moveOpportunityStage(
    id: string,
    newStage: OpportunityStage,
    userId?: string
  ): Promise<Opportunity> {
    const supabase = requireSupabase();

    // 1. Fetch current opportunity
    const current = await OpportunityService.fetchOpportunity(id);
    const fromStage = current.stage;
    const now = new Date();

    // Calculate how long the opportunity was in the previous stage (milliseconds)
    const durationInStage = current.stageEnteredAt
      ? now.getTime() - current.stageEnteredAt.getTime()
      : null;

    // Look up the default win probability for the new stage
    const stageConfig = PIPELINE_STAGES_DEFAULT.find(
      (s) => s.slug === newStage
    );
    const winProbability =
      stageConfig?.winProbability ?? current.winProbability;

    // 2. Update the opportunity
    const { data: updated, error: updateError } = await supabase
      .from("opportunities")
      .update({
        stage: newStage,
        stage_entered_at: now.toISOString(),
        win_probability: winProbability,
        stage_manually_set: true, // Prevent AI/deterministic override
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      throw new Error(
        `Failed to move opportunity ${id} to stage ${newStage}: ${updateError.message}`
      );
    }

    // 3. Insert stage transition record
    const { error: transitionError } = await supabase
      .from("stage_transitions")
      .insert({
        company_id: current.companyId,
        opportunity_id: id,
        from_stage: fromStage,
        to_stage: newStage,
        transitioned_at: now.toISOString(),
        transitioned_by: userId ?? null,
        duration_in_stage: durationInStage,
      });

    if (transitionError) {
      // Log but don't fail – the opportunity was already moved
      console.error(
        `Failed to record stage transition for opportunity ${id}:`,
        transitionError.message
      );
    }

    return mapOpportunityFromDb(updated as Record<string, unknown>);
  },

  /**
   * Soft delete an opportunity.
   * Sets deleted_at timestamp rather than physically deleting.
   */
  async deleteOpportunity(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("opportunities")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to delete opportunity ${id}: ${error.message}`);
    }
  },

  /**
   * Archive an opportunity.
   * Sets archived_at timestamp — the opportunity is hidden from the default
   * pipeline view but remains queryable via includeArchived option.
   */
  async archiveOpportunity(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("opportunities")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    if (error)
      throw new Error(`Failed to archive opportunity: ${error.message}`);
  },

  /**
   * Unarchive an opportunity.
   * Clears the archived_at timestamp, making it visible in the default
   * pipeline view again.
   */
  async unarchiveOpportunity(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("opportunities")
      .update({ archived_at: null })
      .eq("id", id);
    if (error)
      throw new Error(`Failed to unarchive opportunity: ${error.message}`);
  },

  // ─── Activities ───────────────────────────────────────────────────────────

  /**
   * Fetch all activities for an opportunity.
   * Returns most recent activities first.
   */
  async fetchActivities(opportunityId: string): Promise<Activity[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("activities")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(
        `Failed to fetch activities for opportunity ${opportunityId}: ${error.message}`
      );
    }

    return (data ?? []).map((row) =>
      mapActivityFromDb(row as Record<string, unknown>)
    );
  },

  /**
   * Create a new activity record.
   */
  async createActivity(data: CreateActivity): Promise<Activity> {
    const supabase = requireSupabase();

    const row = mapActivityToDb(data);

    const { data: created, error } = await supabase
      .from("activities")
      .insert(row)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create activity: ${error.message}`);
    }

    return mapActivityFromDb(created as Record<string, unknown>);
  },

  // ─── Follow-Ups ──────────────────────────────────────────────────────────

  /**
   * Fetch all follow-ups for an opportunity.
   * Returns soonest-due follow-ups first.
   */
  async fetchFollowUps(opportunityId: string): Promise<FollowUp[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("follow_ups")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("due_at", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to fetch follow-ups for opportunity ${opportunityId}: ${error.message}`
      );
    }

    return (data ?? []).map((row) =>
      mapFollowUpFromDb(row as Record<string, unknown>)
    );
  },

  /**
   * Create a new follow-up.
   */
  async createFollowUp(data: CreateFollowUp): Promise<FollowUp> {
    const supabase = requireSupabase();

    const row = mapFollowUpToDb(data);

    const { data: created, error } = await supabase
      .from("follow_ups")
      .insert(row)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create follow-up: ${error.message}`);
    }

    return mapFollowUpFromDb(created as Record<string, unknown>);
  },

  /**
   * Mark a follow-up as completed.
   * Sets status to Completed, records the completion timestamp and optional notes.
   */
  async completeFollowUp(id: string, notes?: string): Promise<FollowUp> {
    const supabase = requireSupabase();

    const updateData: Record<string, unknown> = {
      status: FollowUpStatus.Completed,
      completed_at: new Date().toISOString(),
    };

    if (notes !== undefined) {
      updateData.completion_notes = notes;
    }

    const { data: updated, error } = await supabase
      .from("follow_ups")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to complete follow-up ${id}: ${error.message}`);
    }

    return mapFollowUpFromDb(updated as Record<string, unknown>);
  },

  // ─── Lifecycle Attach Helpers ─────────────────────────────────────────────

  /**
   * Attach a client to an opportunity and update any linked estimates.
   */
  async attachClientToOpportunity(
    opportunityId: string,
    clientId: string
  ): Promise<Opportunity> {
    const supabase = requireSupabase();

    // Update opportunity
    const { data: updated, error } = await supabase
      .from("opportunities")
      .update({ client_id: clientId })
      .eq("id", opportunityId)
      .select()
      .single();

    if (error)
      throw new Error(
        `Failed to attach client to opportunity: ${error.message}`
      );

    // Also update any estimates linked to this opportunity that lack a client
    await supabase
      .from("estimates")
      .update({ client_id: clientId })
      .eq("opportunity_id", opportunityId)
      .is("client_id", null);

    return mapOpportunityFromDb(updated as Record<string, unknown>);
  },

  // NOTE (P6): the dead `attachProjectToOpportunity` was removed. It wrote the
  // wrong link columns (opportunities.project_id only — never the FK-backed
  // project_ref — and the dead estimates.project_id text column), which was the
  // mechanism behind the historical project_id-vs-project_ref drift. The
  // opportunity ↔ project link is now written ONLY through the guarded RPC in
  // ProjectConversionService, which writes the full four-column contract
  // atomically. No service should write these link columns directly.

  // ─── Stage Transitions ────────────────────────────────────────────────────

  /**
   * Fetch all stage transitions for an opportunity.
   * Returns transitions in chronological order (oldest first).
   */
  async fetchStageTransitions(
    opportunityId: string
  ): Promise<StageTransition[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("stage_transitions")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("transitioned_at", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to fetch stage transitions for opportunity ${opportunityId}: ${error.message}`
      );
    }

    return (data ?? []).map((row) =>
      mapStageTransitionFromDb(row as Record<string, unknown>)
    );
  },

  // ─── Stage Configs ────────────────────────────────────────────────────────

  /**
   * Fetch the per-company pipeline stage configurations.
   *
   * Returns every non-deleted stage config for the company, ordered by
   * sort_order ascending. A company with no config rows yet returns `[]` — the
   * pipeline table falls back to PIPELINE_STAGES_DEFAULT in that case. Powers
   * the table's weighted-forecast (default_win_probability) and rotting
   * (stale_threshold_days) signals.
   */
  async fetchStageConfigs(companyId: string): Promise<PipelineStageConfig[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("pipeline_stage_configs")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to fetch stage configs for company ${companyId}: ${error.message}`
      );
    }

    return (data ?? []).map((row) =>
      mapStageConfigRow(row as Record<string, unknown>)
    );
  },
};

export default OpportunityService;
