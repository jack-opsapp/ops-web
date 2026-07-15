import { randomUUID } from "node:crypto";

export interface ClaimedEmailAttachmentInspectionJob {
  id: string;
  companyId: string;
  emailAttachmentId: string;
  /** Incremented whenever newer attachment work invalidates an older lease. */
  generation: number;
  /** Number of prior processing attempts, used for deterministic backoff. */
  attempts: number;
}

interface InspectionJobLease {
  job: ClaimedEmailAttachmentInspectionJob;
  workerId: string;
}

export interface EmailAttachmentInspectionJobStore {
  /**
   * Atomically claim no more than `limit` due or expired-lease jobs for this
   * worker. Implementations own the durable processing status and lease expiry.
   */
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailAttachmentInspectionJob[]>;

  /**
   * Every transition must atomically match job id, generation, processing
   * status, and lease owner. `false` means newer work or another worker won.
   */
  markComplete(input: InspectionJobLease): Promise<boolean>;
  markRetry(
    input: InspectionJobLease & {
      error: string;
      availableAt: Date;
    }
  ): Promise<boolean>;
  markSkipped(
    input: InspectionJobLease & {
      reason: string;
    }
  ): Promise<boolean>;
  markFailed(
    input: InspectionJobLease & {
      error: string;
    }
  ): Promise<boolean>;
}

export type EmailAttachmentInspectionOutcome =
  | { outcome: "complete" }
  | { outcome: "retry"; error: string }
  | { outcome: "skip"; reason: string };

export interface EmailAttachmentInspectionWorkerDependencies {
  store: EmailAttachmentInspectionJobStore;
  /**
   * Pure worker boundary. The injected implementation may inspect and persist
   * the result; this module has no knowledge of storage or provider APIs.
   */
  inspect: (
    job: ClaimedEmailAttachmentInspectionJob
  ) => Promise<EmailAttachmentInspectionOutcome>;
  now?: () => Date;
  workerId?: () => string;
}

export interface EmailAttachmentInspectionWorkerResult {
  claimed: number;
  completed: number;
  retrying: number;
  skipped: number;
  staleCompletions: number;
  failed: number;
  errors: Array<{ jobId: string; error: string }>;
}

export interface EmailAttachmentInspectionWorkerOptions {
  limit?: number;
  concurrency?: number;
  leaseSeconds?: number;
}

const MAX_ATTACHMENT_INSPECTION_ATTEMPTS = 8;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value as number)));
}

function safeText(value: unknown, fallback: string): string {
  const text =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : fallback;
  return (
    text
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, 1000) || fallback
  );
}

function retryAvailableAt(
  job: ClaimedEmailAttachmentInspectionJob,
  now: Date
): Date {
  const exponent = Math.min(Math.max(Math.floor(job.attempts), 0), 30);
  const delayMs = Math.min(60_000 * 2 ** exponent, 24 * 60 * 60 * 1000);
  return new Date(now.getTime() + delayMs);
}

export async function runEmailAttachmentInspectionWorker(
  dependencies: EmailAttachmentInspectionWorkerDependencies,
  options: EmailAttachmentInspectionWorkerOptions = {}
): Promise<EmailAttachmentInspectionWorkerResult> {
  const limit = boundedInteger(options.limit, 10, 1, 50);
  const concurrency = boundedInteger(options.concurrency, 2, 1, 10);
  const leaseSeconds = boundedInteger(options.leaseSeconds, 240, 30, 900);
  const workerId = (dependencies.workerId ?? randomUUID)();
  const now = dependencies.now ?? (() => new Date());
  const jobs = await dependencies.store.claim({
    workerId,
    limit,
    leaseSeconds,
  });

  const result: EmailAttachmentInspectionWorkerResult = {
    claimed: jobs.length,
    completed: 0,
    retrying: 0,
    skipped: 0,
    staleCompletions: 0,
    failed: 0,
    errors: [],
  };

  let nextIndex = 0;

  const processOne = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const job = jobs[index];
      if (!job) return;

      let outcome: EmailAttachmentInspectionOutcome;
      try {
        outcome = await dependencies.inspect(job);
      } catch (error) {
        outcome = {
          outcome: "retry",
          error: safeText(error, "Attachment inspection failed"),
        };
      }

      try {
        let updated: boolean;
        if (outcome.outcome === "complete") {
          updated = await dependencies.store.markComplete({ job, workerId });
          if (updated) result.completed += 1;
        } else if (outcome.outcome === "skip") {
          updated = await dependencies.store.markSkipped({
            job,
            workerId,
            reason: safeText(outcome.reason, "Attachment inspection skipped"),
          });
          if (updated) result.skipped += 1;
        } else {
          const error = safeText(outcome.error, "Attachment inspection retry");
          if (job.attempts >= MAX_ATTACHMENT_INSPECTION_ATTEMPTS) {
            updated = await dependencies.store.markFailed({
              job,
              workerId,
              error,
            });
            if (updated) {
              result.failed += 1;
              result.errors.push({ jobId: job.id, error });
            }
          } else {
            updated = await dependencies.store.markRetry({
              job,
              workerId,
              error,
              availableAt: retryAvailableAt(job, now()),
            });
            if (updated) result.retrying += 1;
          }
        }

        if (!updated) result.staleCompletions += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          jobId: job.id,
          error: safeText(error, "Attachment inspection transition failed"),
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, processOne)
  );

  return result;
}
