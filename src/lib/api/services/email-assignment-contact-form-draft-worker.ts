import "server-only";

import type { EmailConnection } from "@/lib/types/email-connection";
import type { EmailThreadCategory } from "@/lib/types/email-thread";
import {
  extractContactFormSubmission,
  type ContactFormSubmissionIdentity,
} from "@/lib/utils/email-parsing";
import { buildContactFormDraftInstruction } from "./mailbox-draft-push";
import type { EffectiveEmailSignature } from "./email-signature-service";
import type { CreateNewThreadDraftResult } from "./email-provider";
import type { EmailConnectionSyncLockRunResult } from "./email-connection-sync-lock";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";

const DEFAULT_LIMIT = 3;
const DEFAULT_LEASE_SECONDS = 360;
const CUSTOMER_DRAFT_LEVELS = new Set([
  "auto_draft",
  "auto_send",
  "auto_follow_up",
]);

export interface ClaimedEmailAssignmentContactFormDraft {
  id: string;
  assignmentEventId: string;
  companyId: string;
  opportunityId: string;
  assignmentVersion: number;
  actorUserId: string;
  connectionId: string;
  sourceActivityId: string;
  providerMessageId: string;
  sourceProviderThreadId: string;
  customerEmail: string;
  customerName: string | null;
  sourceSubject: string;
  sourceBodyText: string;
  createdAt: string;
  attempts: number;
  draftHistoryId: string | null;
  draftBody: string | null;
  draftSubject: string | null;
}

export type ContactFormDraftFailureDisposition =
  | "retrying"
  | "failed"
  | "stale"
  | "reconciliation_required";

export interface ContactFormDraftProviderPlacementAttempt {
  attemptId: string;
  mode: "create" | "update";
  priorDraftHistoryId: string | null;
  mailboxDraftId: string | null;
  providerThreadId: string | null;
}

export type ContactFormDraftTransport = {
  createNewThreadDraft(
    to: string,
    subject: string,
    body: string,
    contentType?: "text" | "html"
  ): Promise<CreateNewThreadDraftResult>;
  updateDraft(
    draftId: string,
    to: string,
    subject: string,
    body: string,
    threadId?: string,
    contentType?: "text" | "html"
  ): Promise<void>;
};

interface GeneratedContactFormDraft {
  available: boolean;
  draft: string;
  draftHistoryId: string;
  subject?: string;
  reason?: string;
}

interface PreparedContactFormDraft {
  draftHistoryId: string;
  body: string;
  subject: string;
}

export interface EmailAssignmentContactFormDraftDependencies {
  claim(input: {
    holder: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailAssignmentContactFormDraft[]>;
  reauthorize(input: { queueId: string; holder: string }): Promise<boolean>;
  loadConnection(connectionId: string): Promise<EmailConnection | null>;
  getCustomerAutonomy(
    connectionId: string,
    actorUserId: string,
    category: Extract<EmailThreadCategory, "CUSTOMER">
  ): Promise<string>;
  generateDraft(input: {
    companyId: string;
    userId: string;
    connectionId: string;
    opportunityId: string;
    recipientEmail: string;
    recipientName?: string;
    userInstruction: string;
    profileTypeOverride: "client_new_inquiry";
    autonomous: true;
    origin: "phase_c";
    threadId?: never;
  }): Promise<GeneratedContactFormDraft>;
  prepare(input: {
    queueId: string;
    holder: string;
    draftHistoryId: string;
  }): Promise<boolean>;
  beginProviderCreate(input: {
    queueId: string;
    holder: string;
  }): Promise<ContactFormDraftProviderPlacementAttempt | null>;
  markReconciliationRequired(input: {
    queueId: string;
    holder: string;
    providerCreateAttemptId: string;
    mailboxDraftId: string | null;
    providerThreadId: string | null;
    error: string;
  }): Promise<boolean>;
  resolveSignature(input: {
    connection: EmailConnection;
    userId: string;
    refreshProviderIfMissing: true;
    providerLockCheckpoint: EmailProviderMailboxCheckpoint;
  }): Promise<EffectiveEmailSignature | null>;
  runWithMailboxLease<T>(input: {
    connectionId: string;
    run: (checkpoint: EmailProviderMailboxCheckpoint) => Promise<T>;
  }): Promise<EmailConnectionSyncLockRunResult<T>>;
  renderDraft(
    body: string,
    signature: EffectiveEmailSignature
  ): { body: string; contentType: "text" | "html" };
  getDraftTransport(connection: EmailConnection): ContactFormDraftTransport;
  placeDraft(input: {
    provider: ContactFormDraftTransport;
    connectionId: string;
    opportunityId: string;
    draftHistoryId: string;
    to: string;
    subject: string;
    body: string;
    contentType: "text" | "html";
    phaseCCompanyId: string;
    forceCreate: boolean;
    exactReusableDraft?: {
      mailboxDraftId: string;
      threadId: string;
    };
    providerLockCheckpoint: EmailProviderMailboxCheckpoint;
    persistPlacement: (input: {
      mailboxDraftId: string;
      threadId: string;
    }) => Promise<boolean>;
  }): Promise<{ mailboxDraftId: string; threadId: string | null }>;
  complete(input: {
    queueId: string;
    holder: string;
    mailboxDraftId: string | null;
    providerThreadId: string | null;
    draftHistoryId: string | null;
    providerCreateAttemptId: string | null;
    outcome: "drafted" | "autonomy_ineligible" | "draft_unavailable";
  }): Promise<boolean>;
  fail(input: {
    queueId: string;
    holder: string;
    error: string;
  }): Promise<ContactFormDraftFailureDisposition>;
  workerId(): string;
}

export interface EmailAssignmentContactFormDraftWorkerOptions {
  limit?: number;
  leaseSeconds?: number;
}

export interface EmailAssignmentContactFormDraftWorkerResult {
  claimed: number;
  drafted: number;
  skipped: number;
  retrying: number;
  failed: number;
  stale: number;
  reconciliationRequired: number;
  staleCompletions: number;
  errors: Array<{ queueId: string; error: string }>;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function exactReusableDraftForAttempt(
  attempt: ContactFormDraftProviderPlacementAttempt
): { mailboxDraftId: string; threadId: string } | null {
  if (attempt.mode === "create") {
    if (
      attempt.priorDraftHistoryId !== null ||
      attempt.mailboxDraftId !== null ||
      attempt.providerThreadId !== null
    ) {
      throw new Error(
        "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_CREATE_IDENTITY_INVALID"
      );
    }
    return null;
  }
  if (
    !attempt.priorDraftHistoryId?.trim() ||
    !attempt.mailboxDraftId?.trim() ||
    !attempt.providerThreadId?.trim()
  ) {
    throw new Error(
      "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_REUSE_IDENTITY_INVALID"
    );
  }
  return {
    mailboxDraftId: attempt.mailboxDraftId,
    threadId: attempt.providerThreadId,
  };
}

function validateConnection(
  job: ClaimedEmailAssignmentContactFormDraft,
  connection: EmailConnection | null
): asserts connection is EmailConnection {
  if (
    !connection ||
    connection.id !== job.connectionId ||
    connection.companyId !== job.companyId ||
    connection.status !== "active" ||
    connection.syncEnabled !== true ||
    (connection.type === "individual" && connection.userId !== job.actorUserId)
  ) {
    throw new Error("EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_CONNECTION_INVALID");
  }
}

function parseSubmitter(
  job: ClaimedEmailAssignmentContactFormDraft
): ContactFormSubmissionIdentity {
  const submitter = extractContactFormSubmission(
    job.sourceSubject,
    job.sourceBodyText
  );
  if (!submitter) {
    throw new Error("EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_SOURCE_INVALID");
  }
  if (normalizedEmail(submitter.email) !== normalizedEmail(job.customerEmail)) {
    throw new Error("EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_CUSTOMER_MISMATCH");
  }
  return submitter;
}

function preparedFromClaim(
  job: ClaimedEmailAssignmentContactFormDraft
): PreparedContactFormDraft | null {
  if (!job.draftHistoryId) return null;
  const body = job.draftBody?.trim();
  if (!body) {
    throw new Error("EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_PREPARATION_INVALID");
  }
  return {
    draftHistoryId: job.draftHistoryId,
    body: job.draftBody as string,
    subject: job.draftSubject?.trim() || "Thanks for reaching out",
  };
}

function emptyResult(): EmailAssignmentContactFormDraftWorkerResult {
  return {
    claimed: 0,
    drafted: 0,
    skipped: 0,
    retrying: 0,
    failed: 0,
    stale: 0,
    reconciliationRequired: 0,
    staleCompletions: 0,
    errors: [],
  };
}

export class EmailAssignmentContactFormDraftWorker {
  constructor(
    private readonly dependencies: EmailAssignmentContactFormDraftDependencies
  ) {}

  private async recordFailure(
    result: EmailAssignmentContactFormDraftWorkerResult,
    job: ClaimedEmailAssignmentContactFormDraft,
    holder: string,
    failure: string
  ): Promise<void> {
    try {
      const disposition = await this.dependencies.fail({
        queueId: job.id,
        holder,
        error: failure,
      });
      if (disposition === "reconciliation_required") {
        result.reconciliationRequired += 1;
      } else {
        result[disposition] += 1;
      }
      if (disposition !== "stale") {
        result.errors.push({ queueId: job.id, error: failure });
      }
    } catch (persistenceError) {
      result.failed += 1;
      result.errors.push({
        queueId: job.id,
        error: `${failure}; failure persistence failed: ${errorMessage(
          persistenceError
        )}`,
      });
    }
  }

  private async markSkipped(
    result: EmailAssignmentContactFormDraftWorkerResult,
    job: ClaimedEmailAssignmentContactFormDraft,
    holder: string,
    outcome: "autonomy_ineligible" | "draft_unavailable",
    draftHistoryId: string | null
  ): Promise<void> {
    const completed = await this.dependencies.complete({
      queueId: job.id,
      holder,
      mailboxDraftId: null,
      providerThreadId: null,
      draftHistoryId,
      providerCreateAttemptId: null,
      outcome,
    });
    if (completed) result.skipped += 1;
    else result.staleCompletions += 1;
  }

  async process(
    options: EmailAssignmentContactFormDraftWorkerOptions = {}
  ): Promise<EmailAssignmentContactFormDraftWorkerResult> {
    const holder = this.dependencies.workerId();
    const jobs = await this.dependencies.claim({
      holder,
      limit: boundedInteger(options.limit, DEFAULT_LIMIT, 1, 25),
      leaseSeconds: boundedInteger(
        options.leaseSeconds,
        DEFAULT_LEASE_SECONDS,
        60,
        900
      ),
    });
    const result = emptyResult();
    result.claimed = jobs.length;

    for (const job of jobs) {
      let providerCreateAttemptId: string | null = null;
      let mailboxDraftId: string | null = null;
      let providerThreadId: string | null = null;
      try {
        const connection = await this.dependencies.loadConnection(
          job.connectionId
        );
        validateConnection(job, connection);

        const autonomy = await this.dependencies.getCustomerAutonomy(
          job.connectionId,
          job.actorUserId,
          "CUSTOMER"
        );
        if (!CUSTOMER_DRAFT_LEVELS.has(autonomy)) {
          await this.markSkipped(
            result,
            job,
            holder,
            "autonomy_ineligible",
            job.draftHistoryId
          );
          continue;
        }

        if (
          !(await this.dependencies.reauthorize({
            queueId: job.id,
            holder,
          }))
        ) {
          throw new Error(
            "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_AUTHORIZATION_STALE"
          );
        }

        const submitter = parseSubmitter(job);
        let prepared = preparedFromClaim(job);
        if (!prepared) {
          const generated = await this.dependencies.generateDraft({
            companyId: job.companyId,
            userId: job.actorUserId,
            connectionId: job.connectionId,
            opportunityId: job.opportunityId,
            recipientEmail: job.customerEmail,
            ...(submitter.name || job.customerName
              ? {
                  recipientName:
                    submitter.name || job.customerName || undefined,
                }
              : {}),
            userInstruction: buildContactFormDraftInstruction(submitter),
            profileTypeOverride: "client_new_inquiry",
            autonomous: true,
            origin: "phase_c",
          });
          if (
            !generated.available ||
            !generated.draft?.trim() ||
            !generated.draftHistoryId?.trim()
          ) {
            await this.markSkipped(
              result,
              job,
              holder,
              "draft_unavailable",
              generated.draftHistoryId?.trim() || null
            );
            continue;
          }
          const preparedPersisted = await this.dependencies.prepare({
            queueId: job.id,
            holder,
            draftHistoryId: generated.draftHistoryId,
          });
          if (!preparedPersisted) {
            throw new Error(
              "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_PREPARATION_STALE"
            );
          }
          prepared = {
            draftHistoryId: generated.draftHistoryId,
            body: generated.draft,
            subject: generated.subject?.trim() || "Thanks for reaching out",
          };
        }

        const mailboxLease = await this.dependencies.runWithMailboxLease({
          connectionId: job.connectionId,
          run: async (checkpoint) => {
            const signature = await this.dependencies.resolveSignature({
              connection,
              userId: job.actorUserId,
              refreshProviderIfMissing: true,
              providerLockCheckpoint: checkpoint,
            });
            if (!signature) throw new Error("EMAIL_SIGNATURE_REQUIRED");
            const rendered = this.dependencies.renderDraft(
              prepared.body,
              signature
            );

            // Model work happens before the mailbox lease. Re-check the exact
            // assignment/event/queue lease while holding the physical-mailbox
            // lease, immediately before the durable provider boundary.
            if (
              !(await this.dependencies.reauthorize({
                queueId: job.id,
                holder,
              }))
            ) {
              throw new Error(
                "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_AUTHORIZATION_STALE"
              );
            }

            await checkpoint();
            // The one-shot attempt is durable before the provider boundary. A
            // null response means an earlier attempt may already have crossed
            // that boundary, so this worker must never create again.
            const providerPlacementAttempt =
              await this.dependencies.beginProviderCreate({
                queueId: job.id,
                holder,
              });
            if (!providerPlacementAttempt) {
              return "reconciliation_required" as const;
            }
            providerCreateAttemptId = providerPlacementAttempt.attemptId;
            const exactReusableDraft = exactReusableDraftForAttempt(
              providerPlacementAttempt
            );
            if (exactReusableDraft) {
              mailboxDraftId = exactReusableDraft.mailboxDraftId;
              providerThreadId = exactReusableDraft.threadId;
            }

            await checkpoint();
            const provider = this.dependencies.getDraftTransport(connection);
            const placed = await this.dependencies.placeDraft({
              provider,
              connectionId: job.connectionId,
              opportunityId: job.opportunityId,
              draftHistoryId: prepared.draftHistoryId,
              to: job.customerEmail,
              subject: prepared.subject,
              body: rendered.body,
              contentType: rendered.contentType,
              phaseCCompanyId: job.companyId,
              forceCreate: providerPlacementAttempt.mode === "create",
              ...(exactReusableDraft ? { exactReusableDraft } : {}),
              providerLockCheckpoint: checkpoint,
              persistPlacement: (placement) => {
                mailboxDraftId = placement.mailboxDraftId;
                providerThreadId = placement.threadId;
                return this.dependencies.complete({
                  queueId: job.id,
                  holder,
                  mailboxDraftId: placement.mailboxDraftId,
                  providerThreadId: placement.threadId,
                  draftHistoryId: prepared.draftHistoryId,
                  providerCreateAttemptId,
                  outcome: "drafted",
                });
              },
            });
            if (!placed.mailboxDraftId?.trim() || !placed.threadId?.trim()) {
              throw new Error(
                "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_PROVIDER_IDENTITY_MISSING"
              );
            }
            return "drafted" as const;
          },
        });
        if (!mailboxLease.acquired) {
          throw new Error("EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_MAILBOX_BUSY");
        }
        if (mailboxLease.value === "reconciliation_required") {
          result.reconciliationRequired += 1;
          continue;
        }
        result.drafted += 1;
      } catch (error) {
        const failure = errorMessage(error);
        if (providerCreateAttemptId) {
          try {
            const reconciled =
              await this.dependencies.markReconciliationRequired({
                queueId: job.id,
                holder,
                providerCreateAttemptId,
                mailboxDraftId,
                providerThreadId,
                error: failure,
              });
            if (reconciled) result.reconciliationRequired += 1;
            else result.staleCompletions += 1;
          } catch (persistenceError) {
            // Never route an uncertain provider acceptance through the retry
            // RPC. The durable attempt lets the lease-recovery path quarantine
            // it without creating a second mailbox draft.
            result.failed += 1;
            result.errors.push({
              queueId: job.id,
              error: `${failure}; reconciliation persistence failed: ${errorMessage(
                persistenceError
              )}`,
            });
          }
          continue;
        }
        await this.recordFailure(result, job, holder, failure);
      }
    }

    return result;
  }
}
