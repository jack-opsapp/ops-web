import { describe, expect, it, vi } from "vitest";

import { ProviderAuthError } from "@/lib/api/services/email-provider";
import {
  runEmailAttachmentWorker,
  type ClaimedEmailAttachmentScan,
  type EmailAttachmentScanStore,
} from "@/lib/api/services/email-attachments/attachment-worker";

function scan(
  id: string,
  overrides: Partial<ClaimedEmailAttachmentScan> = {}
): ClaimedEmailAttachmentScan {
  return {
    id,
    companyId: "company-1",
    connectionId: "connection-1",
    activityId: `activity-${id}`,
    providerThreadId: `thread-${id}`,
    messageId: `message-${id}`,
    generation: 3,
    attempts: 1,
    ...overrides,
  };
}

class FakeStore implements EmailAttachmentScanStore {
  claimed = [scan("complete"), scan("retry"), scan("auth")];
  completed: Array<{ scan: ClaimedEmailAttachmentScan; workerId: string }> = [];
  retries: Array<{
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
    availableAt: Date;
  }> = [];
  paused: Array<{
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
  }> = [];
  failures: Array<{
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
  }> = [];

  async claim() {
    return this.claimed;
  }

  async markComplete(claimed: ClaimedEmailAttachmentScan, workerId: string) {
    this.completed.push({ scan: claimed, workerId });
    return true;
  }

  async markRetry(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
    availableAt: Date;
  }) {
    this.retries.push(input);
    return true;
  }

  async markPaused(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
  }) {
    this.paused.push(input);
    return true;
  }

  async markFailed(input: {
    scan: ClaimedEmailAttachmentScan;
    workerId: string;
    error: string;
  }) {
    this.failures.push(input);
    return true;
  }
}

describe("email attachment scan worker", () => {
  it("completes, retries, and auth-pauses claimed scans without losing generation guards", async () => {
    const store = new FakeStore();
    const now = new Date("2026-07-15T09:00:00.000Z");
    const ingest = vi.fn(async (claimed: ClaimedEmailAttachmentScan) => {
      if (claimed.id === "retry") {
        return { requiresRetry: true };
      }
      if (claimed.id === "auth") {
        throw new ProviderAuthError("reconnect required", 401);
      }
      return { requiresRetry: false };
    });

    const result = await runEmailAttachmentWorker(
      {
        store,
        ingest,
        now: () => now,
        workerId: () => "worker-1",
      },
      { limit: 10, concurrency: 3, leaseSeconds: 240 }
    );

    expect(ingest).toHaveBeenCalledTimes(3);
    expect(store.completed).toEqual([
      {
        scan: expect.objectContaining({ id: "complete", generation: 3 }),
        workerId: "worker-1",
      },
    ]);
    expect(store.retries).toEqual([
      expect.objectContaining({
        scan: expect.objectContaining({ id: "retry", generation: 3 }),
        workerId: "worker-1",
        error: "One or more attachment files require retry",
        availableAt: new Date("2026-07-15T09:02:00.000Z"),
      }),
    ]);
    expect(store.paused).toEqual([
      expect.objectContaining({
        scan: expect.objectContaining({ id: "auth", generation: 3 }),
        workerId: "worker-1",
        error: "reconnect required",
      }),
    ]);
    expect(result).toEqual({
      claimed: 3,
      completed: 1,
      retrying: 1,
      paused: 1,
      staleCompletions: 0,
      failed: 0,
      errors: [],
    });
  });

  it("treats a generation-changing completion as stale instead of overwriting new work", async () => {
    const store = new FakeStore();
    store.claimed = [scan("raced")];
    store.markComplete = vi.fn(async () => false);

    const result = await runEmailAttachmentWorker(
      {
        store,
        ingest: async () => ({ requiresRetry: false }),
        now: () => new Date("2026-07-15T09:00:00.000Z"),
        workerId: () => "worker-2",
      },
      { limit: 1, concurrency: 1, leaseSeconds: 240 }
    );

    expect(result.staleCompletions).toBe(1);
    expect(result.completed).toBe(0);
  });

  it("terminalizes and notifies a scan after eight failed attempts", async () => {
    const store = new FakeStore();
    store.claimed = [scan("exhausted", { attempts: 8 })];

    const result = await runEmailAttachmentWorker({
      store,
      ingest: async () => {
        throw new Error("provider page cap exceeded");
      },
      workerId: () => "worker-terminal",
    });

    expect(store.retries).toEqual([]);
    expect(store.failures).toEqual([
      {
        scan: expect.objectContaining({ id: "exhausted", attempts: 8 }),
        workerId: "worker-terminal",
        error: "provider page cap exceeded",
      },
    ]);
    expect(result).toMatchObject({ failed: 1, retrying: 0 });
  });

  it("bounds claim and concurrency inputs", async () => {
    const store = new FakeStore();
    store.claimed = [];
    const claim = vi.spyOn(store, "claim");

    await runEmailAttachmentWorker(
      {
        store,
        ingest: async () => ({ requiresRetry: false }),
        now: () => new Date(),
        workerId: () => "worker-3",
      },
      { limit: 500, concurrency: 500, leaseSeconds: 2 }
    );

    expect(claim).toHaveBeenCalledWith({
      workerId: "worker-3",
      limit: 50,
      leaseSeconds: 30,
    });
  });
});
