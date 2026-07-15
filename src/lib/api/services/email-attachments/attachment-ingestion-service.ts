import { createHash } from "node:crypto";

import {
  DEFAULT_EMAIL_ATTACHMENT_DOWNLOAD_LIMIT_BYTES,
  ProviderAuthError,
  ProviderScopeError,
} from "@/lib/api/services/email-provider";

import {
  buildAttachmentStoragePath,
  decideAttachmentAttribution,
  detectAttachmentMimeFromBytes,
  detectAttachmentMimeType,
  safeAttachmentFilename,
  type AttachmentAttributionStatus,
} from "./attachment-policy";

export const EMAIL_ATTACHMENTS_BUCKET = "email-attachments";
export const DEFAULT_MAX_ATTACHMENT_BYTES =
  DEFAULT_EMAIL_ATTACHMENT_DOWNLOAD_LIMIT_BYTES;
export const DEFAULT_RETRY_BASE_DELAY_MS = 60_000;
export const DEFAULT_RETRY_MAX_DELAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_INGEST_ATTEMPTS = 8;
export const DEFAULT_MAX_DOWNLOADS_PER_RUN = 20;
export const DEFAULT_MAX_AGGREGATE_BYTES_PER_RUN = 50 * 1024 * 1024;

const PERMANENT_PROVIDER_ATTACHMENT_STATUSES = new Set([404, 410]);

export type ProviderAttachmentType = "file" | "inline" | "item" | "reference";

export type CanonicalAttachmentIngestStatus =
  | "discovered"
  | "processing"
  | "stored"
  | "external"
  | "oversized"
  | "unavailable"
  | "retrying"
  | "failed";

export interface ExactEmailActivity {
  id: string;
  companyId: string;
  connectionId: string;
  messageId: string;
  providerThreadId: string;
  opportunityId: string | null;
  direction: "inbound" | "outbound";
  fromEmail: string;
  toEmails: string[];
  matchNeedsReview: boolean;
  occurredAt: Date;
}

export interface ExactActivityIdentity {
  companyId: string;
  connectionId: string;
  activityId: string;
  messageId: string;
}

export interface ProviderAttachmentDescriptor {
  /** Must equal the exact activity's immutable provider message id. */
  messageId: string;
  attachmentId: string;
  filename: string;
  providerMimeType: string;
  sizeBytes: number;
  providerKind: ProviderAttachmentType;
  providerPartId: string | null;
  contentId: string | null;
  isInline: boolean;
  downloadable: boolean;
  externalUrl: string | null;
}

export interface UpsertCanonicalAttachmentInput {
  companyId: string;
  connectionId: string;
  activityId: string;
  opportunityId: string | null;
  attributionStatus: AttachmentAttributionStatus;
  providerThreadId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  providerMimeType: string;
  detectedMimeType: string;
  sizeBytes: number;
  providerKind: ProviderAttachmentType;
  providerPartId: string | null;
  contentId: string | null;
  isInline: boolean;
  sourceUrl: string | null;
  fromEmail: string;
  occurredAt: Date;
  lastSeenAt: Date;
}

export interface CanonicalAttachmentRecord {
  id: string;
  ingestStatus: CanonicalAttachmentIngestStatus;
  ingestAttempts: number;
  storagePath: string | null;
}

export interface CanonicalAttachmentStatusUpdate {
  canonicalAttachmentId: string;
  ingestStatus: CanonicalAttachmentIngestStatus;
  ingestAttempts?: number;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  storageBackend?: "supabase" | null;
  storagePath?: string | null;
  contentSha256?: string | null;
  verifiedSizeBytes?: number | null;
  detectedMimeType?: string | null;
  storedAt?: Date | null;
}

export interface AttachmentActivityRepository {
  /**
   * Resolve by all four immutable ownership fields. Implementations must use
   * equality predicates for company, connection, activity, and message.
   */
  resolveExactActivity(
    identity: ExactActivityIdentity
  ): Promise<ExactEmailActivity | null>;

  listKnownOpportunityContactEmails(input: {
    companyId: string;
    opportunityId: string;
  }): Promise<string[]>;

  upsertCanonicalAttachment(
    input: UpsertCanonicalAttachmentInput
  ): Promise<CanonicalAttachmentRecord>;

  markCanonicalAttachmentStatus(
    input: CanonicalAttachmentStatusUpdate
  ): Promise<void>;

  /**
   * Atomically append and de-duplicate URL strings in activities.attachments.
   * The intentionally narrow boundary cannot write activities.attachment_ids
   * or opportunities.images.
   */
  appendCanonicalAttachmentUrls(input: {
    companyId: string;
    activityId: string;
    canonicalUrls: string[];
  }): Promise<void>;
}

export interface ExactMessageAttachmentProvider {
  enumerateExactMessage(input: {
    connectionId: string;
    messageId: string;
    providerThreadId: string;
  }): Promise<ProviderAttachmentDescriptor[]>;

  downloadExactAttachment(input: {
    connectionId: string;
    messageId: string;
    attachmentId: string;
    providerPartId: string | null;
    providerKind: ProviderAttachmentType;
    maxBytes: number;
  }): Promise<Buffer>;
}

export interface PrivateAttachmentStorage {
  /**
   * Idempotently write to the private bucket and read back enough metadata to
   * verify the durable object. Implementations must target the supplied key.
   */
  putVerifiedPrivateObject(input: {
    bucket: string;
    key: string;
    bytes: Buffer;
    mimeType: string;
    contentSha256: string;
  }): Promise<{
    verifiedSizeBytes: number;
    contentSha256: string;
  }>;
}

export interface AttachmentInspectionQueue {
  /** Idempotent queueing only. Vision must never execute in this service. */
  enqueueCanonicalAttachment(input: {
    canonicalAttachmentId: string;
  }): Promise<void>;
}

export interface AttachmentIngestionDependencies {
  repository: AttachmentActivityRepository;
  provider: ExactMessageAttachmentProvider;
  storage: PrivateAttachmentStorage;
  inspectionQueue: AttachmentInspectionQueue;
  maxAttachmentBytes?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  maxIngestAttempts?: number;
  maxDownloadsPerRun?: number;
  maxAggregateBytesPerRun?: number;
  now?: () => Date;
}

export interface AttachmentIngestionResult {
  activityId: string;
  discovered: number;
  stored: number;
  externalReferences: number;
  oversized: number;
  unavailable: number;
  failed: number;
  retryPending: number;
  requiresRetry: boolean;
  canonicalUrls: string[];
}

export class AttachmentActivityIdentityError extends Error {
  readonly code = "attachment_activity_identity_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "AttachmentActivityIdentityError";
  }
}

export class AttachmentSourceUnavailableError extends Error {
  readonly code = "attachment_source_unavailable" as const;

  constructor(message: string) {
    super(message);
    this.name = "AttachmentSourceUnavailableError";
  }
}

export class AttachmentSourceOversizedError extends Error {
  readonly code = "attachment_source_oversized" as const;

  constructor(
    message: string,
    readonly observedSizeBytes: number | null = null
  ) {
    super(message);
    this.name = "AttachmentSourceOversizedError";
  }
}

export class AttachmentScanRetryableError extends Error {
  readonly code = "attachment_scan_retryable" as const;

  constructor(
    readonly stage:
      | "activity"
      | "contacts"
      | "enumeration"
      | "metadata"
      | "projection"
      | "inspection",
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "AttachmentScanRetryableError";
  }
}

function canonicalAttachmentUrl(id: string): string {
  return `/api/integrations/email/attachment?id=${encodeURIComponent(id)}`;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  return message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 1000);
}

function isProviderCredentialError(
  error: unknown
): error is ProviderAuthError | ProviderScopeError {
  return (
    error instanceof ProviderAuthError || error instanceof ProviderScopeError
  );
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { providerStatus?: unknown }).providerStatus;
  return typeof value === "number" ? value : null;
}

function isPermanentProviderAttachmentError(error: unknown): boolean {
  const status = providerStatus(error);
  return (
    typeof status === "number" &&
    PERMANENT_PROVIDER_ATTACHMENT_STATUSES.has(status)
  );
}

function exactActivityMatches(
  activity: ExactEmailActivity,
  identity: ExactActivityIdentity
): boolean {
  return (
    activity.id === identity.activityId &&
    activity.companyId === identity.companyId &&
    activity.connectionId === identity.connectionId &&
    activity.messageId === identity.messageId
  );
}

function uniqueAttachments(
  attachments: ProviderAttachmentDescriptor[]
): ProviderAttachmentDescriptor[] {
  const byIdentity = new Map<string, ProviderAttachmentDescriptor>();
  for (const attachment of attachments) {
    const key = `${attachment.messageId}\u0000${attachment.attachmentId}`;
    if (!byIdentity.has(key)) byIdentity.set(key, attachment);
  }
  return [...byIdentity.values()];
}

function emptyResult(activityId: string): AttachmentIngestionResult {
  return {
    activityId,
    discovered: 0,
    stored: 0,
    externalReferences: 0,
    oversized: 0,
    unavailable: 0,
    failed: 0,
    retryPending: 0,
    requiresRetry: false,
    canonicalUrls: [],
  };
}

export class AttachmentIngestionService {
  private readonly repository: AttachmentActivityRepository;
  private readonly provider: ExactMessageAttachmentProvider;
  private readonly storage: PrivateAttachmentStorage;
  private readonly inspectionQueue: AttachmentInspectionQueue;
  private readonly maxAttachmentBytes: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly maxIngestAttempts: number;
  private readonly maxDownloadsPerRun: number;
  private readonly maxAggregateBytesPerRun: number;
  private readonly now: () => Date;

  constructor(dependencies: AttachmentIngestionDependencies) {
    this.repository = dependencies.repository;
    this.provider = dependencies.provider;
    this.storage = dependencies.storage;
    this.inspectionQueue = dependencies.inspectionQueue;
    this.maxAttachmentBytes =
      dependencies.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
    this.retryBaseDelayMs =
      dependencies.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs =
      dependencies.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.maxIngestAttempts =
      dependencies.maxIngestAttempts ?? DEFAULT_MAX_INGEST_ATTEMPTS;
    this.maxDownloadsPerRun =
      dependencies.maxDownloadsPerRun ?? DEFAULT_MAX_DOWNLOADS_PER_RUN;
    this.maxAggregateBytesPerRun =
      dependencies.maxAggregateBytesPerRun ??
      DEFAULT_MAX_AGGREGATE_BYTES_PER_RUN;
    this.now = dependencies.now ?? (() => new Date());

    if (
      !Number.isSafeInteger(this.maxAttachmentBytes) ||
      this.maxAttachmentBytes <= 0
    ) {
      throw new TypeError("maxAttachmentBytes must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(this.retryBaseDelayMs) ||
      this.retryBaseDelayMs <= 0
    ) {
      throw new TypeError("retryBaseDelayMs must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(this.retryMaxDelayMs) ||
      this.retryMaxDelayMs <= 0
    ) {
      throw new TypeError("retryMaxDelayMs must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(this.maxIngestAttempts) ||
      this.maxIngestAttempts <= 0
    ) {
      throw new TypeError("maxIngestAttempts must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(this.maxDownloadsPerRun) ||
      this.maxDownloadsPerRun <= 0
    ) {
      throw new TypeError("maxDownloadsPerRun must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(this.maxAggregateBytesPerRun) ||
      this.maxAggregateBytesPerRun <= 0
    ) {
      throw new TypeError(
        "maxAggregateBytesPerRun must be a positive safe integer"
      );
    }
  }

  async ingestExactMessage(
    identity: ExactActivityIdentity
  ): Promise<AttachmentIngestionResult> {
    let activity: ExactEmailActivity | null;
    try {
      activity = await this.repository.resolveExactActivity(identity);
    } catch (error) {
      throw new AttachmentScanRetryableError(
        "activity",
        `Exact activity lookup failed: ${errorMessage(error)}`,
        error
      );
    }

    if (!activity || !exactActivityMatches(activity, identity)) {
      throw new AttachmentActivityIdentityError(
        "No email activity matched the exact company, connection, activity, and message identity"
      );
    }

    let knownContactEmails: string[] = [];
    if (activity.opportunityId) {
      try {
        knownContactEmails =
          await this.repository.listKnownOpportunityContactEmails({
            companyId: activity.companyId,
            opportunityId: activity.opportunityId,
          });
      } catch (error) {
        throw new AttachmentScanRetryableError(
          "contacts",
          `Opportunity participant lookup failed: ${errorMessage(error)}`,
          error
        );
      }
    }

    const attribution = decideAttachmentAttribution({
      opportunityId: activity.opportunityId,
      direction: activity.direction,
      fromEmail: activity.fromEmail,
      toEmails: activity.toEmails,
      knownContactEmails: new Set(knownContactEmails),
      matchNeedsReview: activity.matchNeedsReview,
    });

    let enumerated: ProviderAttachmentDescriptor[];
    try {
      enumerated = await this.provider.enumerateExactMessage({
        connectionId: activity.connectionId,
        messageId: activity.messageId,
        providerThreadId: activity.providerThreadId,
      });
    } catch (error) {
      if (isProviderCredentialError(error)) throw error;
      if (providerStatus(error) === 413) {
        const result = emptyResult(activity.id);
        result.oversized = 1;
        return result;
      }
      if (isPermanentProviderAttachmentError(error)) {
        const result = emptyResult(activity.id);
        result.unavailable = 1;
        return result;
      }
      throw new AttachmentScanRetryableError(
        "enumeration",
        `Exact message attachment enumeration failed: ${errorMessage(error)}`,
        error
      );
    }

    const result = emptyResult(activity.id);
    const canonicalUrls = new Set<string>();
    const inspectionIds = new Set<string>();
    let downloadsStarted = 0;
    let aggregateBytesDownloaded = 0;

    for (const descriptor of uniqueAttachments(enumerated)) {
      if (
        typeof descriptor.messageId !== "string" ||
        descriptor.messageId !== activity.messageId ||
        typeof descriptor.attachmentId !== "string" ||
        !descriptor.attachmentId.trim()
      ) {
        result.unavailable += 1;
        continue;
      }

      const filename = safeAttachmentFilename(descriptor.filename);
      const mimeType = detectAttachmentMimeType(
        descriptor.providerMimeType,
        filename
      );

      let canonical: CanonicalAttachmentRecord;
      try {
        canonical = await this.repository.upsertCanonicalAttachment({
          companyId: activity.companyId,
          connectionId: activity.connectionId,
          activityId: activity.id,
          opportunityId: attribution.opportunityId,
          attributionStatus: attribution.status,
          providerThreadId: activity.providerThreadId,
          messageId: activity.messageId,
          attachmentId: descriptor.attachmentId,
          filename,
          providerMimeType: descriptor.providerMimeType,
          detectedMimeType: mimeType,
          sizeBytes: Math.max(0, descriptor.sizeBytes || 0),
          providerKind: descriptor.providerKind,
          providerPartId: descriptor.providerPartId,
          contentId: descriptor.contentId,
          isInline: descriptor.isInline,
          sourceUrl: descriptor.externalUrl,
          fromEmail: activity.fromEmail,
          occurredAt: activity.occurredAt,
          lastSeenAt: this.now(),
        });
      } catch (error) {
        throw new AttachmentScanRetryableError(
          "metadata",
          `Canonical attachment upsert failed: ${errorMessage(error)}`,
          error
        );
      }

      result.discovered += 1;

      if (canonical.ingestStatus === "stored") {
        result.stored += 1;
        canonicalUrls.add(canonicalAttachmentUrl(canonical.id));
        inspectionIds.add(canonical.id);
        continue;
      }
      if (canonical.ingestStatus === "external") {
        result.externalReferences += 1;
        continue;
      }
      if (canonical.ingestStatus === "oversized") {
        result.oversized += 1;
        continue;
      }
      if (canonical.ingestStatus === "unavailable") {
        result.unavailable += 1;
        continue;
      }
      if (canonical.ingestStatus === "failed") {
        result.failed += 1;
        continue;
      }

      if (descriptor.providerKind === "reference" || !descriptor.downloadable) {
        await this.repository.markCanonicalAttachmentStatus({
          canonicalAttachmentId: canonical.id,
          ingestStatus: "external",
          ingestAttempts: canonical.ingestAttempts,
          lastError: null,
          nextRetryAt: null,
          storageBackend: null,
          storagePath: null,
          contentSha256: null,
          verifiedSizeBytes: null,
          storedAt: null,
        });
        result.externalReferences += 1;
        continue;
      }

      if (descriptor.sizeBytes > this.maxAttachmentBytes) {
        await this.markOversized(canonical, null);
        result.oversized += 1;
        continue;
      }

      const aggregateBytesRemaining = Math.max(
        0,
        this.maxAggregateBytesPerRun - aggregateBytesDownloaded
      );
      if (
        downloadsStarted >= this.maxDownloadsPerRun ||
        aggregateBytesRemaining === 0 ||
        (descriptor.sizeBytes > 0 &&
          descriptor.sizeBytes > aggregateBytesRemaining)
      ) {
        await this.markDeferredForNextRun(canonical);
        result.retryPending += 1;
        result.requiresRetry = true;
        continue;
      }

      let bytes: Buffer;
      downloadsStarted += 1;
      try {
        bytes = await this.provider.downloadExactAttachment({
          connectionId: activity.connectionId,
          messageId: activity.messageId,
          attachmentId: descriptor.attachmentId,
          providerPartId: descriptor.providerPartId,
          providerKind: descriptor.providerKind,
          maxBytes: Math.min(this.maxAttachmentBytes, aggregateBytesRemaining),
        });
      } catch (error) {
        if (error instanceof AttachmentSourceOversizedError) {
          if (
            aggregateBytesRemaining < this.maxAttachmentBytes &&
            (error.observedSizeBytes === null ||
              error.observedSizeBytes <= this.maxAttachmentBytes)
          ) {
            await this.markDeferredForNextRun(canonical);
            result.retryPending += 1;
            result.requiresRetry = true;
          } else {
            await this.markOversized(canonical, error.observedSizeBytes);
            result.oversized += 1;
          }
          continue;
        }
        if (error instanceof AttachmentSourceUnavailableError) {
          await this.markUnavailable(canonical, error);
          result.unavailable += 1;
          continue;
        }
        if (isProviderCredentialError(error)) {
          await this.markRetryPending(canonical, error, false);
          throw error;
        }
        if (providerStatus(error) === 413) {
          await this.markOversized(canonical, null, error);
          result.oversized += 1;
          continue;
        }
        if (isPermanentProviderAttachmentError(error)) {
          await this.markUnavailable(canonical, error);
          result.unavailable += 1;
          continue;
        }
        const status = await this.markRetryPending(canonical, error);
        if (status === "failed") {
          result.failed += 1;
        } else {
          result.retryPending += 1;
          result.requiresRetry = true;
        }
        continue;
      }

      if (bytes.byteLength > this.maxAttachmentBytes) {
        await this.markOversized(canonical, bytes.byteLength);
        result.oversized += 1;
        continue;
      }
      aggregateBytesDownloaded += bytes.byteLength;

      const contentSha256 = sha256(bytes);
      const verifiedMimeType = detectAttachmentMimeFromBytes(
        bytes,
        descriptor.providerMimeType,
        filename
      );
      const storageKey = buildAttachmentStoragePath({
        companyId: activity.companyId,
        connectionId: activity.connectionId,
        messageId: activity.messageId,
        attachmentId: descriptor.attachmentId,
      });

      try {
        const verification = await this.storage.putVerifiedPrivateObject({
          bucket: EMAIL_ATTACHMENTS_BUCKET,
          key: storageKey,
          bytes,
          mimeType: verifiedMimeType,
          contentSha256,
        });

        if (
          verification.verifiedSizeBytes !== bytes.byteLength ||
          verification.contentSha256 !== contentSha256
        ) {
          throw new Error(
            `Private object verification mismatch: expected ${bytes.byteLength}/${contentSha256}, received ${verification.verifiedSizeBytes}/${verification.contentSha256}`
          );
        }

        await this.repository.markCanonicalAttachmentStatus({
          canonicalAttachmentId: canonical.id,
          ingestStatus: "stored",
          ingestAttempts: canonical.ingestAttempts + 1,
          lastError: null,
          nextRetryAt: null,
          storageBackend: "supabase",
          storagePath: storageKey,
          contentSha256,
          verifiedSizeBytes: bytes.byteLength,
          detectedMimeType: verifiedMimeType,
          storedAt: this.now(),
        });

        result.stored += 1;
        canonicalUrls.add(canonicalAttachmentUrl(canonical.id));
        inspectionIds.add(canonical.id);
      } catch (error) {
        const status = await this.markRetryPending(canonical, error);
        if (status === "failed") {
          result.failed += 1;
        } else {
          result.retryPending += 1;
          result.requiresRetry = true;
        }
      }
    }

    const urls = [...canonicalUrls].sort();
    if (urls.length > 0) {
      try {
        await this.repository.appendCanonicalAttachmentUrls({
          companyId: activity.companyId,
          activityId: activity.id,
          canonicalUrls: urls,
        });
      } catch (error) {
        throw new AttachmentScanRetryableError(
          "projection",
          `Activity attachment projection failed: ${errorMessage(error)}`,
          error
        );
      }
    }

    for (const canonicalAttachmentId of inspectionIds) {
      try {
        await this.inspectionQueue.enqueueCanonicalAttachment({
          canonicalAttachmentId,
        });
      } catch (error) {
        throw new AttachmentScanRetryableError(
          "inspection",
          `Attachment inspection queueing failed: ${errorMessage(error)}`,
          error
        );
      }
    }

    result.canonicalUrls = urls;
    return result;
  }

  private async markOversized(
    canonical: CanonicalAttachmentRecord,
    observedSizeBytes: number | null,
    error?: unknown
  ): Promise<void> {
    await this.repository.markCanonicalAttachmentStatus({
      canonicalAttachmentId: canonical.id,
      ingestStatus: "oversized",
      ingestAttempts:
        canonical.ingestAttempts + (observedSizeBytes === null ? 0 : 1),
      lastError:
        error === undefined
          ? `Attachment exceeds ${this.maxAttachmentBytes} byte limit`
          : errorMessage(error),
      nextRetryAt: null,
      storageBackend: null,
      storagePath: null,
      contentSha256: null,
      verifiedSizeBytes: observedSizeBytes,
      storedAt: null,
    });
  }

  private async markDeferredForNextRun(
    canonical: CanonicalAttachmentRecord
  ): Promise<void> {
    await this.repository.markCanonicalAttachmentStatus({
      canonicalAttachmentId: canonical.id,
      ingestStatus: "retrying",
      ingestAttempts: canonical.ingestAttempts,
      lastError: "Deferred by per-message attachment processing budget",
      nextRetryAt: new Date(this.now().getTime() + this.retryBaseDelayMs),
      storedAt: null,
    });
  }

  private async markUnavailable(
    canonical: CanonicalAttachmentRecord,
    error: unknown
  ): Promise<void> {
    await this.repository.markCanonicalAttachmentStatus({
      canonicalAttachmentId: canonical.id,
      ingestStatus: "unavailable",
      ingestAttempts: canonical.ingestAttempts + 1,
      lastError: errorMessage(error),
      nextRetryAt: null,
      storageBackend: null,
      storagePath: null,
      contentSha256: null,
      verifiedSizeBytes: null,
      storedAt: null,
    });
  }

  private async markRetryPending(
    canonical: CanonicalAttachmentRecord,
    error: unknown,
    terminalAtLimit = true
  ): Promise<"retrying" | "failed"> {
    const attempts = canonical.ingestAttempts + 1;
    if (terminalAtLimit && attempts >= this.maxIngestAttempts) {
      await this.repository.markCanonicalAttachmentStatus({
        canonicalAttachmentId: canonical.id,
        ingestStatus: "failed",
        ingestAttempts: attempts,
        lastError: errorMessage(error),
        nextRetryAt: null,
        storageBackend: null,
        storagePath: null,
        contentSha256: null,
        verifiedSizeBytes: null,
        storedAt: null,
      });
      return "failed";
    }

    const exponent = Math.min(Math.max(0, attempts - 1), 30);
    const delay = Math.min(
      this.retryBaseDelayMs * 2 ** exponent,
      this.retryMaxDelayMs
    );

    await this.repository.markCanonicalAttachmentStatus({
      canonicalAttachmentId: canonical.id,
      ingestStatus: "retrying",
      ingestAttempts: attempts,
      lastError: errorMessage(error),
      nextRetryAt: new Date(this.now().getTime() + delay),
      storedAt: null,
    });
    return "retrying";
  }
}
