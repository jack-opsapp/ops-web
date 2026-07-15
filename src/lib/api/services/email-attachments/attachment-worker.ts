import { randomUUID } from "node:crypto";

import {
  ProviderAuthError,
  ProviderScopeError,
} from "@/lib/api/services/email-provider";

export interface ClaimedEmailAttachmentScan {
  id: string;
  companyId: string;
  connectionId: string;
  activityId: string;
  providerThreadId: string;
  messageId: string;
  generation: number;
  attempts: number;
}

export interface EmailAttachmentScanStore {
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailAttachmentScan[]>;
  markComplete(
    scan: ClaimedEmailAttachmentScan,
    workerId: string
  ): Promise<boolean>;
  markRetry(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
    availableAt: Date;
  }): Promise<boolean>;
  markPaused(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
  }): Promise<boolean>;
  markFailed(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
  }): Promise<boolean>;
}

export interface EmailAttachmentWorkerDependencies {
  store: EmailAttachmentScanStore;
  ingest: (
    scan: ClaimedEmailAttachmentScan
  ) => Promise<{ requiresRetry: boolean }>;
  now?: () => Date;
  workerId?: () => string;
}

const MAX_ATTACHMENT_SCAN_ATTEMPTS = 8;

export interface EmailAttachmentWorkerResult {
  claimed: number;
  completed: number;
  retrying: number;
  paused: number;
  staleCompletions: number;
  failed: number;
  errors: Array<{ scanId: string; error: string }>;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

function safeError(error: unknown): string {
  const value =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown attachment worker error";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 1000);
}

function retryAt(scan: ClaimedEmailAttachmentScan, now: Date): Date {
  const exponent = Math.min(Math.max(scan.attempts, 0), 10);
  const delayMs = Math.min(60_000 * 2 ** exponent, 24 * 60 * 60 * 1000);
  return new Date(now.getTime() + delayMs);
}

export async function runEmailAttachmentWorker(
  dependencies: EmailAttachmentWorkerDependencies,
  options: {
    limit?: number;
    concurrency?: number;
    leaseSeconds?: number;
  } = {}
): Promise<EmailAttachmentWorkerResult> {
  const limit = boundedInteger(options.limit, 10, 1, 50);
  const concurrency = boundedInteger(options.concurrency, 2, 1, 10);
  const leaseSeconds = boundedInteger(options.leaseSeconds, 240, 30, 900);
  const workerId = (dependencies.workerId ?? randomUUID)();
  const now = dependencies.now ?? (() => new Date());
  const scans = await dependencies.store.claim({
    workerId,
    limit,
    leaseSeconds,
  });

  const result: EmailAttachmentWorkerResult = {
    claimed: scans.length,
    completed: 0,
    retrying: 0,
    paused: 0,
    staleCompletions: 0,
    failed: 0,
    errors: [],
  };

  let nextIndex = 0;
  const processOne = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const scan = scans[index];
      if (!scan) return;

      try {
        const ingestion = await dependencies.ingest(scan);
        if (ingestion.requiresRetry) {
          if (scan.attempts >= MAX_ATTACHMENT_SCAN_ATTEMPTS) {
            const message =
              "One or more attachment files exhausted retry limits";
            const updated = await dependencies.store.markFailed({
              scan,
              workerId,
              error: message,
            });
            if (updated) {
              result.failed += 1;
              result.errors.push({ scanId: scan.id, error: message });
            } else {
              result.staleCompletions += 1;
            }
            continue;
          }
          const updated = await dependencies.store.markRetry({
            scan,
            workerId,
            error: "One or more attachment files require retry",
            availableAt: retryAt(scan, now()),
          });
          if (updated) result.retrying += 1;
          else result.staleCompletions += 1;
          continue;
        }

        const updated = await dependencies.store.markComplete(scan, workerId);
        if (updated) result.completed += 1;
        else result.staleCompletions += 1;
      } catch (error) {
        const message = safeError(error);
        try {
          if (
            error instanceof ProviderAuthError ||
            error instanceof ProviderScopeError
          ) {
            const updated = await dependencies.store.markPaused({
              scan,
              workerId,
              error: message,
            });
            if (updated) result.paused += 1;
            else result.staleCompletions += 1;
          } else if (scan.attempts >= MAX_ATTACHMENT_SCAN_ATTEMPTS) {
            const updated = await dependencies.store.markFailed({
              scan,
              workerId,
              error: message,
            });
            if (updated) {
              result.failed += 1;
              result.errors.push({ scanId: scan.id, error: message });
            } else {
              result.staleCompletions += 1;
            }
          } else {
            const updated = await dependencies.store.markRetry({
              scan,
              workerId,
              error: message,
              availableAt: retryAt(scan, now()),
            });
            if (updated) result.retrying += 1;
            else result.staleCompletions += 1;
          }
        } catch (statusError) {
          result.failed += 1;
          result.errors.push({
            scanId: scan.id,
            error: safeError(statusError),
          });
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, scans.length) }, processOne)
  );
  return result;
}
