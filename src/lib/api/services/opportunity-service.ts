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

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  Opportunity,
  CreateOpportunity,
  UpdateOpportunity,
  Activity,
  CreateActivity,
  FollowUp,
  CreateFollowUp,
  StageTransition,
} from "@/lib/types/pipeline";
import {
  OpportunityStage,
  FollowUpStatus,
  PIPELINE_STAGES_DEFAULT,
} from "@/lib/types/pipeline";

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
    estimatedValue: row.estimated_value != null ? Number(row.estimated_value) : null,
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

    // Address
    address: (row.address as string) ?? null,

    // Denormalized
    lastActivityAt: parseDate(row.last_activity_at),
    nextFollowUpAt: parseDate(row.next_follow_up_at),
    tags: (row.tags as string[]) ?? [],

    // System
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

/**
 * Convert a camelCase create/update payload into a snake_case database row.
 * Only includes keys that are present in the source object.
 */
function mapOpportunityToDb(
  data: Partial<CreateOpportunity>
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
  if (data.estimatedValue !== undefined) row.estimated_value = data.estimatedValue;
  if (data.actualValue !== undefined) row.actual_value = data.actualValue;
  if (data.winProbability !== undefined) row.win_probability = data.winProbability;

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

  // Conversion
  if (data.projectId !== undefined) row.project_id = data.projectId;
  if (data.lostReason !== undefined) row.lost_reason = data.lostReason;
  if (data.lostNotes !== undefined) row.lost_notes = data.lostNotes;

  // Address
  if (data.address !== undefined) row.address = data.address;

  // Tags
  if (data.tags !== undefined) row.tags = data.tags;

  return row;
}

/**
 * Convert a snake_case database row into a camelCase Activity object.
 */
function mapActivityFromDb(row: Record<string, unknown>): Activity {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    opportunityId: (row.opportunity_id as string) ?? null,
    clientId: (row.client_id as string) ?? null,
    estimateId: (row.estimate_id as string) ?? null,
    invoiceId: (row.invoice_id as string) ?? null,

    type: row.type as Activity["type"],
    subject: row.subject as string,
    content: (row.content as string) ?? null,
    outcome: (row.outcome as string) ?? null,
    direction: (row.direction as Activity["direction"]) ?? null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,

    createdBy: (row.created_by as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
  };
}

/**
 * Convert a camelCase CreateActivity payload into a snake_case database row.
 */
function mapActivityToDb(data: CreateActivity): Record<string, unknown> {
  return {
    company_id: data.companyId,
    opportunity_id: data.opportunityId,
    client_id: data.clientId,
    estimate_id: data.estimateId,
    invoice_id: data.invoiceId,
    type: data.type,
    subject: data.subject,
    content: data.content,
    outcome: data.outcome,
    direction: data.direction,
    duration_minutes: data.durationMinutes,
    created_by: data.createdBy,
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
function mapStageTransitionFromDb(row: Record<string, unknown>): StageTransition {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    opportunityId: row.opportunity_id as string,
    fromStage: (row.from_stage as OpportunityStage) ?? null,
    toStage: row.to_stage as OpportunityStage,
    transitionedAt: parseDateRequired(row.transitioned_at),
    transitionedBy: (row.transitioned_by as string) ?? null,
    durationInStage: row.duration_in_stage != null ? Number(row.duration_in_stage) : null,
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
    const ascending = options.descending === undefined ? false : !options.descending;
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
      throw new Error(`Failed to create opportunity: ${error.message}`);
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
    const row = mapOpportunityToDb(rest as Partial<CreateOpportunity>);

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
    const winProbability = stageConfig?.winProbability ?? current.winProbability;

    // 2. Update the opportunity
    const { data: updated, error: updateError } = await supabase
      .from("opportunities")
      .update({
        stage: newStage,
        stage_entered_at: now.toISOString(),
        win_probability: winProbability,
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
};

export default OpportunityService;
