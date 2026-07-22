import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ProviderAttachmentTooLargeError,
  ProviderAuthError,
  ProviderScopeError,
  type EmailAttachmentMeta,
  type EmailProviderInterface,
} from "@/lib/api/services/email-provider";
import { EmailService } from "@/lib/api/services/email-service";
import { runWithEmailConnectionSyncLock } from "@/lib/api/services/email-connection-sync-lock";
import {
  runEmailProviderMailboxOperation,
  type EmailProviderMailboxCheckpoint,
} from "@/lib/api/services/email-provider-mailbox-operation";
import { evaluateOpportunityAcceptance } from "@/lib/api/services/conversation-state/acceptance-evaluation";
import { refreshLeadSummariesForOpportunities } from "@/lib/api/services/lead-summary-service";
import {
  classifyInspectableAttachment,
  inspectImageContent,
  inspectPdfContent,
  planAttachmentInspections,
} from "@/lib/api/services/conversation-state/attachment-inspector";
import { fetchOperatorIdentity } from "@/lib/api/services/conversation-state/operator-identity";
import { markEmailConnectionNeedsReconnect } from "@/lib/email/email-connection-health";
import type {
  EmailConnection,
  SyncProfile,
} from "@/lib/types/email-connection";

import {
  AttachmentIngestionService,
  AttachmentSourceOversizedError,
  AttachmentSourceUnavailableError,
  EMAIL_ATTACHMENTS_BUCKET,
  type AttachmentActivityRepository,
  type AttachmentInspectionQueue,
  type AttachmentIngestionResult,
  type CanonicalAttachmentRecord,
  type CanonicalAttachmentStatusUpdate,
  type ExactActivityIdentity,
  type ExactEmailActivity,
  type ExactMessageAttachmentProvider,
  type PrivateAttachmentStorage,
  type ProviderAttachmentDescriptor,
  type UpsertCanonicalAttachmentInput,
} from "./attachment-ingestion-service";
import {
  runEmailAttachmentInspectionWorker,
  type ClaimedEmailAttachmentInspectionJob,
  type EmailAttachmentInspectionJobStore,
  type EmailAttachmentInspectionWorkerResult,
} from "./attachment-inspection-worker";
import {
  runEmailAttachmentWorker,
  type ClaimedEmailAttachmentScan,
  type EmailAttachmentScanStore,
  type EmailAttachmentWorkerResult,
} from "./attachment-worker";
import { normalizeAttachmentImageForVision } from "./attachment-vision-normalizer";

interface ScanRow {
  id: string;
  company_id: string;
  connection_id: string;
  activity_id: string;
  provider_thread_id: string;
  message_id: string;
  generation: number | string;
  attempts: number | string;
}

function mapScan(row: ScanRow): ClaimedEmailAttachmentScan {
  return {
    id: row.id,
    companyId: row.company_id,
    connectionId: row.connection_id,
    activityId: row.activity_id,
    providerThreadId: row.provider_thread_id,
    messageId: row.message_id,
    generation: Number(row.generation) || 0,
    attempts: Number(row.attempts) || 0,
  };
}

function cleanError(error: string): string {
  return error
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 1000);
}

export class SupabaseAttachmentScanStore implements EmailAttachmentScanStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailAttachmentScan[]> {
    const { data, error } = await this.supabase.rpc(
      "claim_email_attachment_scans",
      {
        p_worker_id: input.workerId,
        p_limit: input.limit,
        p_lease_seconds: input.leaseSeconds,
      }
    );
    if (error) {
      throw new Error(`Attachment scan claim failed: ${error.message}`);
    }
    return ((data ?? []) as ScanRow[]).map(mapScan);
  }

  async claimSpecific(input: {
    identity: ExactActivityIdentity;
    workerId: string;
    leaseSeconds: number;
  }): Promise<ClaimedEmailAttachmentScan | null> {
    const { data, error } = await this.supabase.rpc(
      "claim_email_attachment_scan",
      {
        p_company_id: input.identity.companyId,
        p_connection_id: input.identity.connectionId,
        p_activity_id: input.identity.activityId,
        p_message_id: input.identity.messageId,
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      }
    );
    if (error) {
      throw new Error(`Exact attachment scan claim failed: ${error.message}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapScan(row as ScanRow) : null;
  }

  async markComplete(
    scan: ClaimedEmailAttachmentScan,
    workerId: string
  ): Promise<boolean> {
    return this.finish(scan, workerId, {
      status: "complete",
      scanned_at: new Date().toISOString(),
      last_error: null,
    });
  }

  async markRetry(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
    availableAt: Date;
  }): Promise<boolean> {
    return this.finish(input.scan, input.workerId, {
      status: "retrying",
      available_at: input.availableAt.toISOString(),
      last_error: cleanError(input.error),
    });
  }

  async markPaused(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
  }): Promise<boolean> {
    return this.finish(input.scan, input.workerId, {
      status: "paused",
      last_error: cleanError(input.error),
    });
  }

  async markFailed(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
  }): Promise<boolean> {
    return this.finish(input.scan, input.workerId, {
      status: "failed",
      last_error: cleanError(input.error),
    });
  }

  private async finish(
    scan: ClaimedEmailAttachmentScan,
    workerId: string,
    update: Record<string, unknown>
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("email_attachment_scans")
      .update({
        ...update,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", scan.id)
      .eq("generation", scan.generation)
      .eq("lease_owner", workerId)
      .eq("status", "processing")
      .select("id");
    if (error) {
      throw new Error(`Attachment scan status update failed: ${error.message}`);
    }
    return (data ?? []).length === 1;
  }
}

export class SupabaseAttachmentRepository implements AttachmentActivityRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async resolveExactActivity(
    identity: ExactActivityIdentity
  ): Promise<ExactEmailActivity | null> {
    const { data, error } = await this.supabase
      .from("activities")
      .select(
        "id,company_id,email_connection_id,email_message_id,email_thread_id,opportunity_id,direction,from_email,to_emails,match_needs_review,created_at"
      )
      .eq("id", identity.activityId)
      .eq("company_id", identity.companyId)
      .eq("email_connection_id", identity.connectionId)
      .eq("email_message_id", identity.messageId)
      .eq("type", "email")
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id as string,
      companyId: data.company_id as string,
      connectionId: data.email_connection_id as string,
      messageId: data.email_message_id as string,
      providerThreadId: (data.email_thread_id as string) || "",
      opportunityId: (data.opportunity_id as string | null) ?? null,
      direction: data.direction === "outbound" ? "outbound" : "inbound",
      fromEmail: (data.from_email as string | null) ?? "",
      toEmails: (data.to_emails as string[] | null) ?? [],
      matchNeedsReview: Boolean(data.match_needs_review),
      occurredAt: new Date(data.created_at as string),
    };
  }

  async listKnownOpportunityContactEmails(input: {
    companyId: string;
    opportunityId: string;
  }): Promise<string[]> {
    const { data: opportunity, error } = await this.supabase
      .from("opportunities")
      .select("contact_email,client_id")
      .eq("id", input.opportunityId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (error) throw error;
    if (!opportunity) return [];

    const emails = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value === "string" && value.trim()) {
        emails.add(value.toLowerCase().trim());
      }
    };
    add(opportunity.contact_email);

    const clientId = opportunity.client_id as string | null;
    if (clientId) {
      const [
        { data: client, error: clientError },
        { data: contacts, error: contactsError },
      ] = await Promise.all([
        this.supabase
          .from("clients")
          .select("email")
          .eq("id", clientId)
          .eq("company_id", input.companyId)
          .maybeSingle(),
        this.supabase
          .from("sub_clients")
          .select("email")
          .eq("client_id", clientId)
          .eq("company_id", input.companyId)
          .is("deleted_at", null),
      ]);
      if (clientError) throw clientError;
      if (contactsError) throw contactsError;
      add(client?.email);
      for (const contact of contacts ?? []) add(contact.email);
    }
    return [...emails];
  }

  async upsertCanonicalAttachment(
    input: UpsertCanonicalAttachmentInput
  ): Promise<CanonicalAttachmentRecord> {
    const { data, error } = await this.supabase
      .from("email_attachments")
      .upsert(
        {
          company_id: input.companyId,
          connection_id: input.connectionId,
          activity_id: input.activityId,
          opportunity_id: input.opportunityId,
          attribution_status: input.attributionStatus,
          provider_thread_id: input.providerThreadId,
          message_id: input.messageId,
          attachment_id: input.attachmentId,
          filename: input.filename,
          mime_type: input.providerMimeType,
          detected_mime_type: input.detectedMimeType,
          size_bytes: input.sizeBytes,
          provider_kind: input.providerKind,
          provider_part_id: input.providerPartId,
          content_id: input.contentId,
          is_inline: input.isInline,
          source_url: input.sourceUrl,
          from_email: input.fromEmail,
          occurred_at: input.occurredAt.toISOString(),
          last_seen_at: input.lastSeenAt.toISOString(),
          updated_at: input.lastSeenAt.toISOString(),
        },
        {
          onConflict: "company_id,connection_id,message_id,attachment_id",
        }
      )
      .select("id,ingest_status,ingest_attempts,storage_path")
      .single();
    if (error || !data) {
      throw new Error(
        `Canonical attachment upsert failed: ${error?.message ?? "no row"}`
      );
    }
    return {
      id: data.id as string,
      ingestStatus:
        data.ingest_status as CanonicalAttachmentRecord["ingestStatus"],
      ingestAttempts: Number(data.ingest_attempts) || 0,
      storagePath: (data.storage_path as string | null) ?? null,
    };
  }

  async markCanonicalAttachmentStatus(
    input: CanonicalAttachmentStatusUpdate
  ): Promise<void> {
    const update: Record<string, unknown> = {
      ingest_status: input.ingestStatus,
      updated_at: new Date().toISOString(),
    };
    if (input.ingestAttempts !== undefined) {
      update.ingest_attempts = input.ingestAttempts;
    }
    if (input.lastError !== undefined) update.last_error = input.lastError;
    if (input.nextRetryAt !== undefined) {
      update.next_retry_at = input.nextRetryAt?.toISOString() ?? null;
    }
    if (input.storageBackend !== undefined) {
      update.storage_backend = input.storageBackend;
    }
    if (input.storagePath !== undefined)
      update.storage_path = input.storagePath;
    if (input.contentSha256 !== undefined) {
      update.content_sha256 = input.contentSha256;
    }
    if (input.verifiedSizeBytes !== undefined) {
      update.verified_size_bytes = input.verifiedSizeBytes;
    }
    if (input.detectedMimeType !== undefined) {
      update.detected_mime_type = input.detectedMimeType;
    }
    if (input.storedAt !== undefined) {
      update.stored_at = input.storedAt?.toISOString() ?? null;
    }

    const { error } = await this.supabase
      .from("email_attachments")
      .update(update)
      .eq("id", input.canonicalAttachmentId);
    if (error) throw error;
  }

  async appendCanonicalAttachmentUrls(input: {
    companyId: string;
    activityId: string;
    canonicalUrls: string[];
  }): Promise<void> {
    void input.companyId;
    void input.canonicalUrls;
    const { error } = await this.supabase.rpc(
      "refresh_email_activity_attachments",
      { p_activity_id: input.activityId }
    );
    if (error) throw error;
  }
}

export class ProviderAttachmentAdapter implements ExactMessageAttachmentProvider {
  constructor(
    private readonly provider: EmailProviderInterface,
    private readonly connectionId: string,
    private readonly providerLockCheckpoint?: EmailProviderMailboxCheckpoint
  ) {}

  async enumerateExactMessage(input: {
    connectionId: string;
    messageId: string;
    providerThreadId: string;
  }): Promise<ProviderAttachmentDescriptor[]> {
    if (input.connectionId !== this.connectionId) {
      throw new Error("Attachment provider connection identity changed");
    }
    await this.providerLockCheckpoint?.();
    const attachments = await this.provider.getAttachmentsFromMessage(
      input.messageId
    );
    await this.providerLockCheckpoint?.();
    return attachments.map(mapProviderAttachment);
  }

  async downloadExactAttachment(input: {
    connectionId: string;
    messageId: string;
    attachmentId: string;
    maxBytes: number;
  }): Promise<Buffer> {
    if (input.connectionId !== this.connectionId) {
      throw new Error("Attachment provider connection identity changed");
    }
    try {
      await this.providerLockCheckpoint?.();
      const bytes = await this.provider.fetchAttachment(
        input.messageId,
        input.attachmentId,
        input.maxBytes
      );
      await this.providerLockCheckpoint?.();
      return bytes;
    } catch (error) {
      if (error instanceof ProviderAttachmentTooLargeError) {
        throw new AttachmentSourceOversizedError(
          error.message,
          error.observedSizeBytes
        );
      }
      const status = (error as { providerStatus?: number } | null)
        ?.providerStatus;
      if (status === 404 || status === 410) {
        throw new AttachmentSourceUnavailableError(
          "Provider attachment no longer exists"
        );
      }
      throw error;
    }
  }
}

export function mapProviderAttachment(
  attachment: EmailAttachmentMeta
): ProviderAttachmentDescriptor {
  return {
    messageId: attachment.messageId,
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    providerMimeType: attachment.mimeType,
    sizeBytes: attachment.size,
    providerKind: attachment.providerKind,
    providerPartId: attachment.providerPartId,
    contentId: attachment.contentId,
    isInline: attachment.isInline,
    downloadable: attachment.downloadSupported,
    externalUrl: attachment.sourceUrl,
  };
}

export class SupabasePrivateAttachmentStorage implements PrivateAttachmentStorage {
  constructor(private readonly supabase: SupabaseClient) {}

  async putVerifiedPrivateObject(input: {
    bucket: string;
    key: string;
    bytes: Buffer;
    mimeType: string;
    contentSha256: string;
  }): Promise<{ verifiedSizeBytes: number; contentSha256: string }> {
    if (input.bucket !== EMAIL_ATTACHMENTS_BUCKET) {
      throw new Error("Unexpected attachment storage bucket");
    }
    const bucket = this.supabase.storage.from(input.bucket);
    const { error: uploadError } = await bucket.upload(
      input.key,
      new Uint8Array(input.bytes),
      {
        contentType: input.mimeType,
        upsert: true,
        cacheControl: "0",
      }
    );
    if (uploadError) {
      throw new Error(
        `Private attachment upload failed: ${uploadError.message}`
      );
    }

    const { data, error: downloadError } = await bucket.download(input.key);
    if (downloadError || !data) {
      throw new Error(
        `Private attachment verification download failed: ${downloadError?.message ?? "no bytes"}`
      );
    }
    const verified = Buffer.from(await data.arrayBuffer());
    return {
      verifiedSizeBytes: verified.byteLength,
      contentSha256: createHash("sha256").update(verified).digest("hex"),
    };
  }
}

interface InspectionJobRow {
  id: string;
  company_id: string;
  email_attachment_id: string;
  generation: number | string;
  attempts: number | string;
}

function mapInspectionJob(
  row: InspectionJobRow
): ClaimedEmailAttachmentInspectionJob {
  return {
    id: row.id,
    companyId: row.company_id,
    emailAttachmentId: row.email_attachment_id,
    generation: Number(row.generation) || 0,
    attempts: Number(row.attempts) || 0,
  };
}

export class SupabaseAttachmentInspectionJobStore implements EmailAttachmentInspectionJobStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailAttachmentInspectionJob[]> {
    const { data, error } = await this.supabase.rpc(
      "claim_email_attachment_inspection_jobs",
      {
        p_worker_id: input.workerId,
        p_limit: input.limit,
        p_lease_seconds: input.leaseSeconds,
      }
    );
    if (error) {
      throw new Error(`Attachment inspection claim failed: ${error.message}`);
    }
    return ((data ?? []) as InspectionJobRow[]).map(mapInspectionJob);
  }

  async claimSpecific(input: {
    emailAttachmentId: string;
    workerId: string;
    leaseSeconds: number;
  }): Promise<ClaimedEmailAttachmentInspectionJob | null> {
    const { data, error } = await this.supabase.rpc(
      "claim_email_attachment_inspection_job",
      {
        p_email_attachment_id: input.emailAttachmentId,
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      }
    );
    if (error) {
      throw new Error(
        `Exact attachment inspection claim failed: ${error.message}`
      );
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapInspectionJob(row as InspectionJobRow) : null;
  }

  async markComplete(input: {
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
  }): Promise<boolean> {
    return this.finish(input.job, input.workerId, {
      status: "complete",
      inspected_at: new Date().toISOString(),
      last_error: null,
      skip_reason: null,
    });
  }

  async markRetry(input: {
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    error: string;
    availableAt: Date;
  }): Promise<boolean> {
    return this.finish(input.job, input.workerId, {
      status: "retrying",
      available_at: input.availableAt.toISOString(),
      last_error: cleanError(input.error),
      skip_reason: null,
    });
  }

  async markSkipped(input: {
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    reason: string;
  }): Promise<boolean> {
    return this.finish(input.job, input.workerId, {
      status: "skipped",
      last_error: null,
      skip_reason: cleanError(input.reason),
    });
  }

  async markFailed(input: {
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    error: string;
  }): Promise<boolean> {
    return this.finish(input.job, input.workerId, {
      status: "failed",
      last_error: cleanError(input.error),
      skip_reason: null,
    });
  }

  private async finish(
    job: ClaimedEmailAttachmentInspectionJob,
    workerId: string,
    update: Record<string, unknown>
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("email_attachment_inspection_jobs")
      .update({
        ...update,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("generation", job.generation)
      .eq("lease_owner", workerId)
      .eq("status", "processing")
      .select("id");
    if (error) {
      throw new Error(
        `Attachment inspection status update failed: ${error.message}`
      );
    }
    return (data ?? []).length === 1;
  }
}

interface InspectionAttachmentRow {
  id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  message_id: string;
  attachment_id: string;
  filename: string | null;
  detected_mime_type: string | null;
  mime_type: string | null;
  from_email: string | null;
  storage_path: string | null;
  ingest_status: string;
  attribution_status: string;
}

export type CanonicalAttachmentInspectionOutcome =
  | { kind: "complete" }
  | {
      kind: "skip";
      reason: "not_attributed" | "not_stored" | "unsupported" | "operator_sent";
    };

async function reevaluateAcceptanceAfterCanonicalInspection(
  supabase: SupabaseClient,
  connection: EmailConnection,
  canonicalAttachmentId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("email_attachments")
    .select(
      "connection_id,provider_thread_id,opportunity_id,attribution_status"
    )
    .eq("id", canonicalAttachmentId)
    .eq("company_id", connection.companyId)
    .eq("connection_id", connection.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("Inspected attachment lost its exact mailbox identity");
  }
  if (data.attribution_status !== "attributed") return;

  const providerThreadId = (data.provider_thread_id as string | null)?.trim();
  const opportunityId = (data.opportunity_id as string | null)?.trim();
  if (!providerThreadId || !opportunityId) {
    throw new Error("Attributed attachment lost its acceptance target");
  }

  await evaluateOpportunityAcceptance({
    supabase,
    connection,
    providerThreadId,
    opportunityId,
  });

  // Inspection can make a previously neutral attachment decisive only after
  // the normal sync summary has already run. Keep summary refresh inside the
  // inspection job boundary and repeat it on retries even when conversion was
  // idempotently applied by an earlier attempt.
  const summaryRefresh = await refreshLeadSummariesForOpportunities({
    supabase,
    companyId: connection.companyId,
    opportunityIds: [opportunityId],
  });
  if (summaryRefresh.failed.length > 0) {
    throw new Error(
      `Attachment acceptance summary refresh failed: ${summaryRefresh.failed
        .map((failure) => `${failure.opportunityId}: ${failure.error}`)
        .join("; ")}`
    );
  }
}

export class SupabaseAttachmentInspectionQueue implements AttachmentInspectionQueue {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly connection: EmailConnection,
    private readonly inspectImmediately = false
  ) {}

  async enqueueCanonicalAttachment(input: {
    canonicalAttachmentId: string;
  }): Promise<void> {
    const { error: queueError } = await this.supabase
      .from("email_attachment_inspection_jobs")
      .upsert(
        {
          company_id: this.connection.companyId,
          connection_id: this.connection.id,
          email_attachment_id: input.canonicalAttachmentId,
          status: "pending",
          available_at: new Date().toISOString(),
        },
        { onConflict: "email_attachment_id", ignoreDuplicates: true }
      );
    if (queueError) throw queueError;

    if (this.inspectImmediately) {
      await inspectCanonicalAttachmentImmediately(
        this.supabase,
        this.connection,
        input.canonicalAttachmentId
      );
    }
  }
}

export async function inspectCanonicalAttachmentStoredBytes(
  supabase: SupabaseClient,
  connection: EmailConnection,
  canonicalAttachmentId: string
): Promise<CanonicalAttachmentInspectionOutcome> {
  const { data: cached, error: cacheError } = await supabase
    .from("attachment_inspections")
    .select("id")
    .eq("email_attachment_id", canonicalAttachmentId)
    .eq("company_id", connection.companyId)
    .eq("connection_id", connection.id)
    .limit(1);
  if (cacheError) throw cacheError;
  if ((cached ?? []).length > 0) return { kind: "complete" };

  const { data, error } = await supabase
    .from("email_attachments")
    .select(
      "id,company_id,connection_id,provider_thread_id,message_id,attachment_id,filename,detected_mime_type,mime_type,from_email,storage_path,ingest_status,attribution_status"
    )
    .eq("id", canonicalAttachmentId)
    .eq("company_id", connection.companyId)
    .eq("connection_id", connection.id)
    .maybeSingle();
  if (error) throw error;
  const attachment = data as InspectionAttachmentRow | null;
  if (!attachment) throw new Error("Canonical attachment identity disappeared");
  if (attachment.attribution_status !== "attributed") {
    return { kind: "skip", reason: "not_attributed" };
  }
  if (attachment.ingest_status !== "stored" || !attachment.storage_path) {
    return { kind: "skip", reason: "not_stored" };
  }

  const filename = attachment.filename || "attachment";
  const mimeType =
    attachment.detected_mime_type ||
    attachment.mime_type ||
    "application/octet-stream";
  if (classifyInspectableAttachment(mimeType, filename) === "unsupported") {
    return { kind: "skip", reason: "unsupported" };
  }

  const operator = await fetchOperatorIdentity(attachment.company_id, {
    email: connection.email,
    syncFilters: (connection.syncFilters ?? {}) as SyncProfile,
  });
  const plan = planAttachmentInspections({
    attachments: [
      {
        messageId: attachment.message_id,
        attachmentId: attachment.attachment_id,
        filename,
        mimeType,
        fromEmail: attachment.from_email || "",
      },
    ],
    operatorEmails: operator.emails,
    operatorDomains: operator.domains,
    cachedKeys: new Set(),
  });
  if (plan.length === 0) return { kind: "skip", reason: "operator_sent" };

  const { data: object, error: objectError } = await supabase.storage
    .from(EMAIL_ATTACHMENTS_BUCKET)
    .download(attachment.storage_path);
  if (objectError || !object) {
    throw new Error(
      `Stored attachment inspection read failed: ${objectError?.message ?? "no bytes"}`
    );
  }
  const bytes = Buffer.from(await object.arrayBuffer());
  let inspection;
  if (plan[0].kind === "pdf") {
    inspection = await inspectPdfContent(bytes.toString("base64"), filename);
  } else {
    const normalizedImage = await normalizeAttachmentImageForVision(bytes);
    if (!normalizedImage) {
      return { kind: "skip", reason: "unsupported" };
    }
    inspection = await inspectImageContent(
      normalizedImage.bytes.toString("base64"),
      normalizedImage.mimeType,
      filename
    );
  }

  const { error: inspectionError } = await supabase
    .from("attachment_inspections")
    .upsert(
      {
        company_id: attachment.company_id,
        connection_id: attachment.connection_id,
        email_attachment_id: attachment.id,
        provider_thread_id: attachment.provider_thread_id,
        message_id: attachment.message_id,
        attachment_id: attachment.attachment_id,
        summary: inspection.summary || null,
        is_signed_estimate: inspection.isSignedEstimate,
        facts: inspection.facts,
        model: inspection.model,
        inspected_at: new Date().toISOString(),
      },
      { onConflict: "email_attachment_id", ignoreDuplicates: true }
    );
  if (inspectionError) throw inspectionError;
  return { kind: "complete" };
}

export async function inspectCanonicalAttachmentImmediately(
  supabase: SupabaseClient,
  connection: EmailConnection,
  canonicalAttachmentId: string
): Promise<void> {
  const store = new SupabaseAttachmentInspectionJobStore(supabase);
  const workerId = randomUUID();
  const job = await store.claimSpecific({
    emailAttachmentId: canonicalAttachmentId,
    workerId,
    leaseSeconds: 240,
  });
  if (!job) return;

  try {
    const outcome = await inspectCanonicalAttachmentStoredBytes(
      supabase,
      connection,
      canonicalAttachmentId
    );
    if (outcome.kind === "skip") {
      await store.markSkipped({ job, workerId, reason: outcome.reason });
    } else {
      await reevaluateAcceptanceAfterCanonicalInspection(
        supabase,
        connection,
        canonicalAttachmentId
      );
      await store.markComplete({ job, workerId });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Attachment inspection failed";
    if (job.attempts >= 8) {
      await store.markFailed({ job, workerId, error: message });
    } else {
      const exponent = Math.min(Math.max(job.attempts, 0), 30);
      const delayMs = Math.min(60_000 * 2 ** exponent, 24 * 60 * 60 * 1000);
      await store.markRetry({
        job,
        workerId,
        error: message,
        availableAt: new Date(Date.now() + delayMs),
      });
    }
    throw error;
  }
}

async function requireActiveConnection(
  scan: ClaimedEmailAttachmentScan
): Promise<EmailConnection> {
  const connection = await EmailService.getConnection(scan.connectionId);
  if (
    !connection ||
    connection.companyId !== scan.companyId ||
    connection.status !== "active" ||
    !connection.syncEnabled
  ) {
    throw new ProviderAuthError(
      "Attachment scan paused until the owning mailbox reconnects"
    );
  }
  return connection;
}

async function markConnectionNeedsReconnect(
  supabase: SupabaseClient,
  connection: EmailConnection
): Promise<void> {
  await markEmailConnectionNeedsReconnect({
    connectionId: connection.id,
    supabase,
  });
}

export async function ingestExactActivityAttachments(
  supabase: SupabaseClient,
  connection: EmailConnection,
  identity: ExactActivityIdentity,
  options: {
    inspectImmediately?: boolean;
    providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
  } = {}
) {
  if (
    identity.companyId !== connection.companyId ||
    identity.connectionId !== connection.id
  ) {
    throw new Error("Attachment ingestion mailbox identity changed");
  }

  const scanStore = new SupabaseAttachmentScanStore(supabase);
  const inlineWorkerId = options.inspectImmediately ? randomUUID() : null;
  let inlineScan: ClaimedEmailAttachmentScan | null = null;
  if (options.inspectImmediately) {
    inlineScan = await scanStore.claimSpecific({
      identity,
      workerId: inlineWorkerId!,
      leaseSeconds: 360,
    });
    if (!inlineScan) {
      return {
        activityId: identity.activityId,
        discovered: 0,
        stored: 0,
        externalReferences: 0,
        oversized: 0,
        unavailable: 0,
        failed: 0,
        retryPending: 0,
        requiresRetry: false,
        canonicalUrls: [],
      } satisfies AttachmentIngestionResult;
    }
  }

  try {
    const result = await runEmailProviderMailboxOperation({
      supabase,
      connectionId: connection.id,
      context: "email-attachment-ingestion",
      busyError: "EMAIL_ATTACHMENT_MAILBOX_BUSY",
      providerLockCheckpoint: options.providerLockCheckpoint,
      run: async (checkpoint) => {
        const provider = EmailService.getProvider(connection);
        const service = new AttachmentIngestionService({
          repository: new SupabaseAttachmentRepository(supabase),
          provider: new ProviderAttachmentAdapter(
            provider,
            connection.id,
            checkpoint
          ),
          storage: new SupabasePrivateAttachmentStorage(supabase),
          inspectionQueue: new SupabaseAttachmentInspectionQueue(
            supabase,
            connection,
            options.inspectImmediately ?? false
          ),
        });
        return service.ingestExactMessage(identity);
      },
    });
    if (inlineScan && inlineWorkerId) {
      if (result.requiresRetry) {
        await scanStore.markRetry({
          scan: inlineScan,
          workerId: inlineWorkerId,
          error: "One or more attachment files require retry",
          availableAt: new Date(Date.now() + 60_000),
        });
      } else {
        await notifyAttachmentCopyExceptions(supabase, inlineScan.id, result);
        await scanStore.markComplete(inlineScan, inlineWorkerId);
      }
    }
    return result;
  } catch (error) {
    let transitionError = error;
    if (
      error instanceof ProviderAuthError ||
      error instanceof ProviderScopeError
    ) {
      try {
        await markConnectionNeedsReconnect(supabase, connection);
      } catch (statusError) {
        transitionError = statusError;
      }
    }
    if (inlineScan && inlineWorkerId) {
      if (
        transitionError instanceof ProviderAuthError ||
        transitionError instanceof ProviderScopeError
      ) {
        await scanStore.markPaused({
          scan: inlineScan,
          workerId: inlineWorkerId,
          error: transitionError.message,
        });
      } else {
        await scanStore.markRetry({
          scan: inlineScan,
          workerId: inlineWorkerId,
          error:
            transitionError instanceof Error
              ? transitionError.message
              : "Attachment scan failed",
          availableAt: new Date(Date.now() + 60_000),
        });
      }
    }
    throw transitionError;
  }
}

export async function notifyAttachmentCopyExceptions(
  supabase: SupabaseClient,
  scanId: string,
  result: AttachmentIngestionResult
): Promise<void> {
  const exceptionCount =
    result.externalReferences +
    result.oversized +
    result.unavailable +
    result.failed;
  if (exceptionCount === 0) return;

  const { error } = await supabase.rpc(
    "notify_email_attachment_scan_exception_as_system",
    {
      p_scan_id: scanId,
    }
  );
  if (error) {
    throw new Error(
      `Attachment exception notification failed: ${error.message}`
    );
  }
}

async function inspectClaimedCanonicalAttachment(
  supabase: SupabaseClient,
  job: ClaimedEmailAttachmentInspectionJob
) {
  const { data, error } = await supabase
    .from("email_attachments")
    .select("connection_id")
    .eq("id", job.emailAttachmentId)
    .eq("company_id", job.companyId)
    .maybeSingle();
  if (error) throw error;
  const connectionId = (data?.connection_id as string | undefined) ?? null;
  if (!connectionId) {
    throw new Error("Attachment inspection lost its exact mailbox identity");
  }

  const connection = await EmailService.getConnection(connectionId);
  if (!connection || connection.companyId !== job.companyId) {
    throw new Error("Attachment inspection mailbox is outside company scope");
  }

  const outcome = await inspectCanonicalAttachmentStoredBytes(
    supabase,
    connection,
    job.emailAttachmentId
  );
  if (outcome.kind === "complete") {
    await reevaluateAcceptanceAfterCanonicalInspection(
      supabase,
      connection,
      job.emailAttachmentId
    );
  }
  return outcome.kind === "complete"
    ? ({ outcome: "complete" } as const)
    : ({ outcome: "skip", reason: outcome.reason } as const);
}

export async function runSupabaseEmailAttachmentInspectionWorker(
  supabase: SupabaseClient,
  options: { limit?: number; concurrency?: number; leaseSeconds?: number } = {}
): Promise<EmailAttachmentInspectionWorkerResult> {
  return runEmailAttachmentInspectionWorker(
    {
      store: new SupabaseAttachmentInspectionJobStore(supabase),
      inspect: (job) => inspectClaimedCanonicalAttachment(supabase, job),
    },
    options
  );
}

export interface SupabaseEmailAttachmentWorkerResult extends EmailAttachmentWorkerResult {
  inspection: EmailAttachmentInspectionWorkerResult;
}

export async function runSupabaseEmailAttachmentWorker(
  supabase: SupabaseClient,
  options: {
    limit?: number;
    concurrency?: number;
    leaseSeconds?: number;
    inspectionLimit?: number;
    inspectionConcurrency?: number;
  } = {}
): Promise<SupabaseEmailAttachmentWorkerResult> {
  const store = new SupabaseAttachmentScanStore(supabase);
  const scan = await runEmailAttachmentWorker(
    {
      store,
      ingest: async (scan) => {
        const locked = await runWithEmailConnectionSyncLock({
          connectionId: scan.connectionId,
          context: "email-attachment-worker",
          client: supabase,
          run: async (checkpoint) => {
            const connection = await requireActiveConnection(scan);
            const result = await ingestExactActivityAttachments(
              supabase,
              connection,
              {
                companyId: scan.companyId,
                connectionId: scan.connectionId,
                activityId: scan.activityId,
                messageId: scan.messageId,
              },
              {
                providerLockCheckpoint: checkpoint,
              }
            );
            await notifyAttachmentCopyExceptions(supabase, scan.id, result);
            return result;
          },
        });
        if (!locked.acquired) {
          throw new Error("Mailbox is busy. Attachment ingestion will retry.");
        }
        return locked.value;
      },
    },
    options
  );
  const inspection = await runSupabaseEmailAttachmentInspectionWorker(
    supabase,
    {
      limit: options.inspectionLimit,
      concurrency: options.inspectionConcurrency,
      leaseSeconds: options.leaseSeconds,
    }
  );
  return {
    ...scan,
    failed: scan.failed + inspection.failed,
    inspection,
  };
}
