import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authoredMessageBody,
  cleanMessageBody,
} from "./conversation-state/message-cleaner";
import { outboundLearningEvidenceKey } from "@/lib/email/outbound-learning-evidence";

export const OUTBOUND_LEARNING_PREPARATION_VERSION = "outbound-learning-v1";

export type EmailOutboundLearningStatus =
  | "pending"
  | "leased"
  | "completed"
  | "failed";

export type OutboundDraftDeliveryChannel = "ops_send" | "mailbox";

export type OutboundLearningAuthority =
  | "operator_authored"
  | "operator_approved"
  | "autonomous";

export interface OutboundWritingSample {
  profileType: string;
  formalityScore: number;
  avgSentenceLength: number;
  greeting: string | null;
  closing: string | null;
  hedgingFrequency: number;
  punctuation: Record<string, number>;
  paragraphStructure: {
    bulletFrequency: number;
    avgParagraphLines: number;
    prefersBullets: boolean;
  };
  vocabularyComplexity: {
    avgWordLength: number;
    uniqueWordRatio: number;
    usesTradeJargon: boolean;
  };
  engagementStyle: {
    questionsPerEmail: number;
    directAddressFreq: number;
    firstPersonFreq: number;
  };
  emailLength: {
    wordCount: number;
    category: "short" | "medium" | "long";
  };
}

export interface OutboundMemoryExtraction {
  facts: Array<{
    evidenceKey: string;
    type: string;
    category: string;
    content: string;
    confidence: number;
    embedding: number[] | null;
  }>;
  edges: Array<{
    evidenceKey: string;
    subjectType: string;
    subjectId: string;
    predicate: string;
    objectType: string;
    objectId: string;
    properties: Record<string, unknown>;
  }>;
}

export interface OutboundDraftOutcome {
  finalVersion: string;
  editDistance: number;
  changesMade: Array<{ type: string; from: string; to: string }>;
  sentWithoutChanges: boolean;
  subject: string;
  subjectEdited: boolean;
  edited: boolean;
  contentCorrections: string[];
}

export interface EmailOutboundLearningJob {
  id: string;
  companyId: string;
  connectionId: string;
  providerMessageId: string;
  providerThreadId: string | null;
  userId: string | null;
  fromEmail: string | null;
  toEmails: string[];
  subject: string | null;
  authoredBody: string | null;
  cleanBody: string | null;
  draftHistoryId: string | null;
  followUpDraftId: string | null;
  draftDeliveryChannel: OutboundDraftDeliveryChannel | null;
  opportunityId: string | null;
  profileType: string;
  learningAuthority: OutboundLearningAuthority;
  writingSample: OutboundWritingSample | null;
  memoryExtraction: OutboundMemoryExtraction | null;
  draftOutcome: OutboundDraftOutcome | null;
  draftCorrectionFacts: OutboundMemoryExtraction["facts"] | null;
  applyLearning: boolean | null;
  applyFullBodyLearning: boolean | null;
  preparationVersion: string | null;
  preparedAt: string | null;
  appliedAt: string | null;
  occurredAt: string | null;
  status: EmailOutboundLearningStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  completedLeaseToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueEmailOutboundLearningInput {
  companyId: string;
  connectionId: string;
  providerMessageId: string;
  providerThreadId?: string | null;
  userId?: string | null;
  fromEmail?: string | null;
  toEmails?: string[];
  subject?: string | null;
  bodyText?: string | null;
  authoredBody?: string | null;
  cleanBody?: string | null;
  occurredAt?: Date | string | null;
  labelIds?: string[];
  draftHistoryId?: string | null;
  followUpDraftId?: string | null;
  draftDeliveryChannel?: OutboundDraftDeliveryChannel | null;
  opportunityId?: string | null;
  profileType?: string | null;
  learningAuthority?: OutboundLearningAuthority | null;
}

export interface EmailOutboundLearningDependencies {
  isFeatureEnabled(companyId: string): Promise<boolean>;
  prepareWritingSample(
    authoredBody: string,
    profileType: string
  ): Promise<OutboundWritingSample>;
  prepareMemoryExtraction(input: {
    from: string;
    to: string[];
    subject: string;
    bodyText: string;
  }): Promise<OutboundMemoryExtraction>;
  prepareDraftOutcome(
    job: EmailOutboundLearningJob,
    supabase: SupabaseClient,
    options: { analyzeEdits: boolean }
  ): Promise<OutboundDraftOutcome>;
  prepareCorrectionEmbedding(content: string): Promise<number[] | null>;
  afterApplied?(job: EmailOutboundLearningJob): Promise<void>;
}

export interface EmailOutboundLearningWorkerResult {
  claimed: number;
  prepared: number;
  completed: number;
  deferred: number;
  retrying: number;
  bookkeepingFailed: number;
  terminalFailed: number;
  failed: number;
  errors: Array<{
    jobId: string;
    providerMessageId: string;
    error: string;
  }>;
}

export interface EmailOutboundLearningDiagnostic {
  id: string;
  companyId: string;
  connectionId: string;
  providerMessageId: string;
  providerThreadId: string | null;
  userId: string | null;
  opportunityId: string | null;
  draftHistoryId: string | null;
  followUpDraftId: string | null;
  draftDeliveryChannel: OutboundDraftDeliveryChannel | null;
  status: EmailOutboundLearningStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseExpiresAt: string | null;
  lastError: string | null;
  lastFailedAt: string | null;
  lastTerminalError: string | null;
  requeueCount: number;
  lastRequeuedAt: string | null;
  lastRequeueReason: string | null;
  isPrepared: boolean;
  hasLearningReceipt: boolean;
  appliedAt: string | null;
  completedAt: string | null;
  occurredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailOutboundLearningDiagnosticCursor {
  sortAt: string;
  id: string;
}

export interface EmailOutboundLearningDiagnosticPage {
  items: EmailOutboundLearningDiagnostic[];
  nextCursor: EmailOutboundLearningDiagnosticCursor | null;
}

type QueueDbRow = Record<string, unknown>;

const BLOCKED_LABELS = new Set(["DRAFT", "SPAM", "TRASH"]);

const defaultDependencies: EmailOutboundLearningDependencies = {
  isFeatureEnabled: async (companyId) => {
    const { AdminFeatureOverrideService } =
      await import("./admin-feature-override-service");
    return AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c");
  },
  prepareWritingSample: async (authoredBody, profileType) => {
    const { WritingProfileService } = await import("./writing-profile-service");
    return WritingProfileService.prepareOutboundEmailSample(
      authoredBody,
      profileType
    );
  },
  prepareMemoryExtraction: async (input) => {
    const { MemoryService } = await import("./memory-service");
    return MemoryService.prepareOutboundEmailLearning(input);
  },
  prepareDraftOutcome: async (job, supabase, options) => {
    const baseline: OutboundDraftOutcome = {
      finalVersion: job.authoredBody ?? "",
      editDistance: 0,
      changesMade: [],
      sentWithoutChanges: true,
      subject: job.subject ?? "",
      subjectEdited: false,
      edited: false,
      contentCorrections: [],
    };

    if (!job.draftHistoryId) return baseline;

    const { data, error } = await supabase
      .from("ai_draft_history")
      .select("original_draft, subject, status")
      .eq("id", job.draftHistoryId)
      .eq("company_id", job.companyId)
      .eq("user_id", job.userId ?? "")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(
        "Outbound learning draft history disappeared before preparation"
      );
    }
    if (
      !["drafted", "auto_drafted", "sent", "sent_from_mailbox"].includes(
        String(data.status ?? "")
      )
    ) {
      throw new Error(
        "Outbound learning draft history is not eligible for sent outcome"
      );
    }

    const { prepareSentDraftOutcome } = await import("./ai-draft-service");
    return prepareSentDraftOutcome({
      originalDraft: String(data.original_draft ?? ""),
      originalSubject: data.subject == null ? null : String(data.subject),
      finalVersion: job.authoredBody ?? "",
      finalSubject: job.subject ?? "",
      analyzeSignificantEdits: options.analyzeEdits,
    });
  },
  prepareCorrectionEmbedding: async (content) => {
    const { generateEmbedding } = await import("./memory-service");
    return generateEmbedding(`correction: ${content}`);
  },
  afterApplied: async (job) => {
    if (!job.userId || job.learningAuthority === "autonomous") return;
    const { AutonomyMilestoneService } =
      await import("./autonomy-milestone-service");
    await Promise.all([
      AutonomyMilestoneService.checkMilestonesAfterSync(
        job.companyId,
        job.userId,
        job.connectionId
      ),
      job.draftHistoryId
        ? AutonomyMilestoneService.checkMilestonesAfterDraftFeedback(
            job.companyId,
            job.userId,
            job.connectionId
          )
        : Promise.resolve(),
    ]);
  },
};

function stringValue(value: unknown): string {
  return String(value ?? "");
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function objectOrNull<T>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

function draftDeliveryChannel(
  value: unknown
): OutboundDraftDeliveryChannel | null {
  if (value === "ops_send" || value === "mailbox") return value;
  return null;
}

function learningAuthority(value: unknown): OutboundLearningAuthority {
  if (value === "operator_authored" || value === "operator_approved") {
    return value;
  }
  return "autonomous";
}

function profileType(value: unknown): string {
  const normalized = stringValue(value).trim();
  return normalized ? normalized.slice(0, 64) : "general";
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function mapJob(row: QueueDbRow): EmailOutboundLearningJob {
  return {
    id: stringValue(row.id),
    companyId: stringValue(row.company_id),
    connectionId: stringValue(row.connection_id),
    providerMessageId: stringValue(row.provider_message_id),
    providerThreadId: stringOrNull(row.provider_thread_id),
    userId: stringOrNull(row.user_id),
    fromEmail: stringOrNull(row.from_email),
    toEmails: Array.isArray(row.to_emails)
      ? row.to_emails.map((value) => String(value))
      : [],
    subject: stringOrNull(row.subject),
    authoredBody: stringOrNull(row.authored_body),
    cleanBody: stringOrNull(row.clean_body),
    draftHistoryId: stringOrNull(row.draft_history_id),
    followUpDraftId: stringOrNull(row.follow_up_draft_id),
    draftDeliveryChannel: draftDeliveryChannel(row.draft_delivery_channel),
    opportunityId: stringOrNull(row.opportunity_id),
    profileType: profileType(row.profile_type),
    learningAuthority: learningAuthority(row.learning_authority),
    writingSample: objectOrNull<OutboundWritingSample>(row.writing_sample),
    memoryExtraction: objectOrNull<OutboundMemoryExtraction>(
      row.memory_extraction
    ),
    draftOutcome: objectOrNull<OutboundDraftOutcome>(row.draft_outcome),
    draftCorrectionFacts: Array.isArray(row.draft_correction_facts)
      ? (row.draft_correction_facts as OutboundMemoryExtraction["facts"])
      : null,
    applyLearning: booleanOrNull(row.apply_learning),
    applyFullBodyLearning: booleanOrNull(row.apply_full_body_learning),
    preparationVersion: stringOrNull(row.preparation_version),
    preparedAt: stringOrNull(row.prepared_at),
    appliedAt: stringOrNull(row.applied_at),
    occurredAt: stringOrNull(row.occurred_at),
    status: row.status as EmailOutboundLearningStatus,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 8),
    nextAttemptAt: stringValue(row.next_attempt_at),
    leaseToken: stringOrNull(row.lease_token),
    leaseExpiresAt: stringOrNull(row.lease_expires_at),
    lastError: stringOrNull(row.last_error),
    completedLeaseToken: stringOrNull(row.completed_lease_token),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function mapDiagnostic(row: QueueDbRow): EmailOutboundLearningDiagnostic {
  return {
    id: stringValue(row.id),
    companyId: stringValue(row.company_id),
    connectionId: stringValue(row.connection_id),
    providerMessageId: stringValue(row.provider_message_id),
    providerThreadId: stringOrNull(row.provider_thread_id),
    userId: stringOrNull(row.user_id),
    opportunityId: stringOrNull(row.opportunity_id),
    draftHistoryId: stringOrNull(row.draft_history_id),
    followUpDraftId: stringOrNull(row.follow_up_draft_id),
    draftDeliveryChannel: draftDeliveryChannel(row.draft_delivery_channel),
    status: row.status as EmailOutboundLearningStatus,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    nextAttemptAt: stringValue(row.next_attempt_at),
    leaseExpiresAt: stringOrNull(row.lease_expires_at),
    lastError: stringOrNull(row.last_error),
    lastFailedAt: stringOrNull(row.last_failed_at),
    lastTerminalError: stringOrNull(row.last_terminal_error),
    requeueCount: Number(row.requeue_count ?? 0),
    lastRequeuedAt: stringOrNull(row.last_requeued_at),
    lastRequeueReason: stringOrNull(row.last_requeue_reason),
    isPrepared: row.is_prepared === true,
    hasLearningReceipt: row.has_learning_receipt === true,
    appliedAt: stringOrNull(row.applied_at),
    completedAt: stringOrNull(row.completed_at),
    occurredAt: stringOrNull(row.occurred_at),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function rowsFromRpc(data: unknown): QueueDbRow[] {
  if (!data) return [];
  return (Array.isArray(data) ? data : [data]) as QueueDbRow[];
}

function occurredAtIso(value: Date | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Outbound learning occurredAt must be a valid date");
  }
  return parsed.toISOString();
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? "outbound learning failed");
}

function requireLease(job: EmailOutboundLearningJob): string {
  if (job.status !== "leased" || !job.leaseToken) {
    throw new Error(
      "Outbound learning operation requires a leased job and lease token"
    );
  }
  return job.leaseToken;
}

function prepareInputBodies(input: EnqueueEmailOutboundLearningInput): {
  authoredBody: string;
  cleanBody: string;
} {
  const rawBody = input.bodyText ?? input.authoredBody ?? input.cleanBody ?? "";
  if (!rawBody) return { authoredBody: "", cleanBody: "" };
  const options = {
    subject: input.subject ?? "",
    providerCleanBody: input.cleanBody ?? null,
  };
  const authoredBody = (
    input.authoredBody ?? authoredMessageBody(rawBody, options)
  ).trim();
  return {
    authoredBody,
    // Reconciliation may have already removed an exact configured signature.
    // Never re-derive from the raw provider body and put that footer back into
    // the durable sample. When no explicit clean body exists, derive it from
    // the exact authored representation selected above.
    cleanBody: (
      input.cleanBody ??
      cleanMessageBody(authoredBody, { subject: input.subject ?? "" })
    ).trim(),
  };
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (index < items.length) {
        const item = items[index++];
        await operation(item);
      }
    }
  );
  await Promise.all(workers);
}

export class EmailOutboundLearningService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly dependencies: EmailOutboundLearningDependencies = defaultDependencies
  ) {}

  async enqueue(
    input: EnqueueEmailOutboundLearningInput
  ): Promise<EmailOutboundLearningJob> {
    const providerMessageId = input.providerMessageId.trim();
    if (!providerMessageId) {
      throw new Error("Outbound learning providerMessageId is required");
    }
    const bodies = prepareInputBodies(input);
    if (!bodies.authoredBody || !bodies.cleanBody) {
      throw new Error("Outbound learning clean body is required");
    }

    const { data, error } = await this.supabase.rpc(
      "enqueue_email_outbound_learning",
      {
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_provider_message_id: providerMessageId,
        p_provider_thread_id: input.providerThreadId ?? null,
        p_user_id: input.userId ?? null,
        p_from_email: input.fromEmail ?? null,
        p_to_emails: input.toEmails ?? [],
        p_subject: input.subject ?? null,
        p_authored_body: bodies.authoredBody,
        p_clean_body: bodies.cleanBody,
        p_occurred_at: occurredAtIso(input.occurredAt),
        p_draft_history_id: input.draftHistoryId ?? null,
        p_follow_up_draft_id: input.followUpDraftId ?? null,
        p_opportunity_id: input.opportunityId ?? null,
        p_draft_delivery_channel: input.draftDeliveryChannel ?? null,
        p_profile_type: profileType(input.profileType),
        p_learning_authority: learningAuthority(input.learningAuthority),
      }
    );

    if (error) throw error;
    const row = rowsFromRpc(data)[0];
    if (!row) throw new Error("Outbound learning enqueue returned no job");
    return mapJob(row);
  }

  async enqueueIfEnabled(
    input: EnqueueEmailOutboundLearningInput
  ): Promise<EmailOutboundLearningJob | null> {
    if (!input.userId?.trim()) return null;
    if (
      (input.labelIds ?? []).some((label) =>
        BLOCKED_LABELS.has(label.toUpperCase())
      )
    ) {
      return null;
    }
    const bodies = prepareInputBodies(input);
    if (!bodies.authoredBody || !bodies.cleanBody) return null;
    const hasMandatorySentOutcome = Boolean(
      input.draftHistoryId || input.followUpDraftId
    );
    if (
      !hasMandatorySentOutcome &&
      !(await this.dependencies.isFeatureEnabled(input.companyId))
    ) {
      return null;
    }
    return this.enqueue(input);
  }

  private async claimBatch(
    input: { limit?: number; leaseSeconds?: number } = {}
  ): Promise<{
    jobs: EmailOutboundLearningJob[];
    terminalized: EmailOutboundLearningJob[];
  }> {
    const { data, error } = await this.supabase.rpc(
      "claim_email_outbound_learning",
      {
        p_limit: input.limit ?? 25,
        p_lease_seconds: input.leaseSeconds ?? 300,
      }
    );
    if (error) throw error;
    const rows = rowsFromRpc(data).map(mapJob);
    const unexpected = rows.find(
      (job) => job.status !== "leased" && job.status !== "failed"
    );
    if (unexpected) {
      throw new Error(
        `Outbound learning claim returned unexpected status ${unexpected.status}`
      );
    }
    return {
      jobs: rows.filter((job) => job.status === "leased"),
      terminalized: rows.filter((job) => job.status === "failed"),
    };
  }

  async claim(
    input: { limit?: number; leaseSeconds?: number } = {}
  ): Promise<EmailOutboundLearningJob[]> {
    return (await this.claimBatch(input)).jobs;
  }

  async prepare(
    job: EmailOutboundLearningJob,
    input: {
      applyLearning: boolean;
      writingSample: OutboundWritingSample | null;
      memoryExtraction: OutboundMemoryExtraction | null;
      draftOutcome: OutboundDraftOutcome;
      draftCorrectionFacts: OutboundMemoryExtraction["facts"];
    }
  ): Promise<EmailOutboundLearningJob> {
    const leaseToken = requireLease(job);
    const { data, error } = await this.supabase.rpc(
      "prepare_email_outbound_learning",
      {
        p_job_id: job.id,
        p_lease_token: leaseToken,
        p_apply_learning: input.applyLearning,
        p_apply_full_body_learning:
          input.applyLearning && job.learningAuthority === "operator_authored",
        p_writing_sample: input.writingSample,
        p_memory_extraction: input.memoryExtraction,
        p_draft_outcome: input.draftOutcome,
        p_draft_correction_facts: input.draftCorrectionFacts,
        p_preparation_version: OUTBOUND_LEARNING_PREPARATION_VERSION,
      }
    );
    if (error) throw error;
    const row = rowsFromRpc(data)[0];
    if (!row) {
      throw new Error("Outbound learning preparation lost lease ownership");
    }
    return mapJob(row);
  }

  async apply(
    job: EmailOutboundLearningJob
  ): Promise<EmailOutboundLearningJob> {
    const leaseToken = requireLease(job);
    const { data, error } = await this.supabase.rpc(
      "apply_email_outbound_learning",
      { p_job_id: job.id, p_lease_token: leaseToken }
    );
    if (error) throw error;
    const row = rowsFromRpc(data)[0];
    if (!row) {
      throw new Error("Outbound learning application lost lease ownership");
    }
    return mapJob(row);
  }

  async defer(
    job: EmailOutboundLearningJob,
    reason: string
  ): Promise<EmailOutboundLearningJob> {
    const leaseToken = requireLease(job);
    const { data, error } = await this.supabase.rpc(
      "defer_email_outbound_learning",
      {
        p_job_id: job.id,
        p_lease_token: leaseToken,
        p_reason: reason.slice(0, 4000),
        p_delay_seconds: 900,
      }
    );
    if (error) throw error;
    const row = rowsFromRpc(data)[0];
    if (!row)
      throw new Error("Outbound learning deferral lost lease ownership");
    return mapJob(row);
  }

  async retry(
    job: EmailOutboundLearningJob,
    errorValue: unknown
  ): Promise<EmailOutboundLearningJob> {
    const leaseToken = requireLease(job);
    const { data, error } = await this.supabase.rpc(
      "retry_email_outbound_learning",
      {
        p_job_id: job.id,
        p_lease_token: leaseToken,
        p_error: errorText(errorValue).slice(0, 4000),
      }
    );
    if (error) throw error;
    const row = rowsFromRpc(data)[0];
    if (!row) throw new Error("Outbound learning retry lost lease ownership");
    return mapJob(row);
  }

  async diagnose(
    input: {
      companyId?: string | null;
      status?: EmailOutboundLearningStatus | null;
      limit?: number;
      before?: EmailOutboundLearningDiagnosticCursor | null;
    } = {}
  ): Promise<EmailOutboundLearningDiagnosticPage> {
    const beforeSortAt = input.before?.sortAt ?? null;
    if (beforeSortAt && Number.isNaN(new Date(beforeSortAt).getTime())) {
      throw new Error(
        "Outbound learning diagnostic cursor must be a valid date"
      );
    }
    if (input.before && !input.before.id.trim()) {
      throw new Error("Outbound learning diagnostic cursor id is required");
    }

    const { data, error } = await this.supabase.rpc(
      "diagnose_email_outbound_learning",
      {
        p_company_id: input.companyId?.trim() || null,
        p_status: input.status ?? null,
        p_limit: input.limit ?? 100,
        p_before_sort_at: beforeSortAt,
        p_before_id: input.before?.id ?? null,
      }
    );
    if (error) throw error;

    const items = rowsFromRpc(data).map(mapDiagnostic);
    const last = items.at(-1);
    const sortAt =
      input.status === "failed" ? last?.lastFailedAt : last?.createdAt;
    return {
      items,
      nextCursor: last && sortAt ? { sortAt, id: last.id } : null,
    };
  }

  async requeueFailed(
    jobId: string,
    reason: string
  ): Promise<EmailOutboundLearningJob> {
    const normalizedReason = reason.trim();
    if (!jobId.trim()) {
      throw new Error("Outbound learning job id is required");
    }
    if (!normalizedReason) {
      throw new Error("Outbound learning requeue reason is required");
    }

    const { data, error } = await this.supabase.rpc(
      "requeue_failed_email_outbound_learning",
      {
        p_job_id: jobId,
        p_reason: normalizedReason.slice(0, 1000),
      }
    );
    if (error) throw error;
    const row = rowsFromRpc(data)[0];
    if (!row) throw new Error("Outbound learning requeue returned no job");
    return mapJob(row);
  }

  async runWorker(
    input: {
      limit?: number;
      concurrency?: number;
      leaseSeconds?: number;
    } = {}
  ): Promise<EmailOutboundLearningWorkerResult> {
    const batch = await this.claimBatch({
      limit: Math.max(1, Math.min(input.limit ?? 10, 25)),
      leaseSeconds: input.leaseSeconds ?? 300,
    });
    const jobs = batch.jobs;
    const result: EmailOutboundLearningWorkerResult = {
      claimed: jobs.length,
      prepared: 0,
      completed: 0,
      deferred: 0,
      retrying: 0,
      bookkeepingFailed: 0,
      terminalFailed: batch.terminalized.length,
      failed: batch.terminalized.length,
      errors: batch.terminalized.map((job) => ({
        jobId: job.id,
        providerMessageId: job.providerMessageId,
        error: job.lastError ?? "lease expired after maximum attempts",
      })),
    };

    await runBounded(
      jobs,
      Math.max(1, Math.min(input.concurrency ?? 2, 4)),
      async (job) => {
        try {
          let preparedJob = job;
          if (
            !job.preparedAt ||
            job.applyLearning === null ||
            job.applyFullBodyLearning === null ||
            !job.draftOutcome ||
            !job.draftCorrectionFacts
          ) {
            if (!job.authoredBody || !job.cleanBody) {
              throw new Error(
                "Outbound learning job has no authored/clean body"
              );
            }
            const applyLearning =
              job.learningAuthority !== "autonomous" &&
              (await this.dependencies.isFeatureEnabled(job.companyId));
            const applyFullBodyLearning =
              applyLearning && job.learningAuthority === "operator_authored";
            if (!applyLearning && !job.draftHistoryId && !job.followUpDraftId) {
              await this.defer(job, "phase_c feature disabled");
              result.deferred++;
              return;
            }
            const [writingSample, rawMemoryExtraction, draftOutcome] =
              await Promise.all([
                applyFullBodyLearning
                  ? (job.writingSample ??
                    this.dependencies.prepareWritingSample(
                      job.authoredBody,
                      job.profileType
                    ))
                  : null,
                applyFullBodyLearning
                  ? (job.memoryExtraction ??
                    this.dependencies.prepareMemoryExtraction({
                      from: job.fromEmail ?? "",
                      to: job.toEmails,
                      subject: job.subject ?? "",
                      bodyText: job.cleanBody,
                    }))
                  : null,
                job.draftOutcome ??
                  this.dependencies.prepareDraftOutcome(job, this.supabase, {
                    analyzeEdits: applyLearning,
                  }),
              ]);
            const seenEvidence = new Set<string>();
            const baseFacts: OutboundMemoryExtraction["facts"] = [];
            for (const fact of rawMemoryExtraction?.facts ?? []) {
              if (
                !fact.evidenceKey ||
                seenEvidence.has(fact.evidenceKey) ||
                baseFacts.length >= 50
              ) {
                continue;
              }
              seenEvidence.add(fact.evidenceKey);
              baseFacts.push(fact);
            }
            const seenEdges = new Set<string>();
            const baseEdges: OutboundMemoryExtraction["edges"] = [];
            for (const edge of rawMemoryExtraction?.edges ?? []) {
              if (
                !edge.evidenceKey ||
                seenEdges.has(edge.evidenceKey) ||
                baseEdges.length >= 50
              ) {
                continue;
              }
              seenEdges.add(edge.evidenceKey);
              baseEdges.push(edge);
            }
            const seenCorrections = new Set<string>();
            const correctionCandidates = applyLearning
              ? draftOutcome.contentCorrections
                  .map((content) => content.trim().replace(/\s+/g, " "))
                  .filter((content) => {
                    const normalized = content.toLowerCase();
                    if (!content || seenCorrections.has(normalized))
                      return false;
                    seenCorrections.add(normalized);
                    return true;
                  })
                  .map((content) => ({
                    evidenceKey: outboundLearningEvidenceKey(
                      "draft-correction",
                      [content]
                    ),
                    content,
                  }))
                  .filter(({ evidenceKey }) => {
                    if (!evidenceKey || seenEvidence.has(evidenceKey))
                      return false;
                    seenEvidence.add(evidenceKey);
                    return true;
                  })
                  .slice(0, 20)
              : [];
            const draftCorrectionFacts = await Promise.all(
              correctionCandidates.map(async ({ evidenceKey, content }) => ({
                evidenceKey,
                type: "fact",
                category: "correction",
                content,
                confidence: 0.9,
                embedding:
                  await this.dependencies.prepareCorrectionEmbedding(content),
              }))
            );
            preparedJob = await this.prepare(job, {
              applyLearning,
              writingSample,
              memoryExtraction: rawMemoryExtraction
                ? {
                    facts: baseFacts,
                    edges: baseEdges,
                  }
                : null,
              draftOutcome,
              draftCorrectionFacts,
            });
            result.prepared++;
          }

          const appliedJob = await this.apply(preparedJob);
          if (
            this.dependencies.afterApplied &&
            appliedJob.learningAuthority !== "autonomous"
          ) {
            try {
              await this.dependencies.afterApplied(appliedJob);
            } catch (milestoneError) {
              console.error(
                "[outbound-learning] post-apply milestone evaluation failed",
                {
                  jobId: appliedJob.id,
                  error: errorText(milestoneError),
                }
              );
            }
          }
          result.completed++;
        } catch (error) {
          const message = errorText(error);
          // Enqueue may atomically enrich a provider-only job with draft
          // provenance while this worker is preparing it. That deliberately
          // revokes the old lease so the next claim recomputes the outcome from
          // the now-complete provenance instead of applying stale baseline data.
          if (message.includes("lost lease ownership")) {
            result.deferred++;
            return;
          }
          try {
            const retryResult = await this.retry(job, error);
            // A lost HTTP response can arrive after the apply transaction
            // committed. The retry RPC recognizes the exact completing token and
            // returns the completed job without replaying any effect.
            if (retryResult.status === "completed") {
              result.completed++;
              return;
            }
            if (retryResult.status === "pending") {
              result.retrying++;
              result.errors.push({
                jobId: job.id,
                providerMessageId: job.providerMessageId,
                error: message,
              });
              return;
            }
            if (retryResult.status === "failed") {
              result.terminalFailed++;
              result.failed++;
              result.errors.push({
                jobId: job.id,
                providerMessageId: job.providerMessageId,
                error: message,
              });
              return;
            }

            result.bookkeepingFailed++;
            result.errors.push({
              jobId: job.id,
              providerMessageId: job.providerMessageId,
              error: message,
            });
            return;
          } catch (retryError) {
            console.error("[outbound-learning] retry bookkeeping failed", {
              jobId: job.id,
              providerMessageId: job.providerMessageId,
              error: errorText(retryError),
            });
            // The retry transaction may have committed even when its response
            // was lost. Report an unknown bookkeeping outcome, never a false
            // terminal failure; a later claim or diagnostic readback resolves it.
            result.bookkeepingFailed++;
            result.errors.push({
              jobId: job.id,
              providerMessageId: job.providerMessageId,
              error: message,
            });
            return;
          }
        }
      }
    );

    return result;
  }
}
