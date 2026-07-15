import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  runEmailAttachmentInspectionWorker,
  type ClaimedEmailAttachmentInspectionJob,
  type EmailAttachmentInspectionJobStore,
} from "@/lib/api/services/email-attachments/attachment-inspection-worker";

function job(
  id: string,
  overrides: Partial<ClaimedEmailAttachmentInspectionJob> = {}
): ClaimedEmailAttachmentInspectionJob {
  return {
    id,
    companyId: "company-1",
    emailAttachmentId: `attachment-${id}`,
    generation: 4,
    attempts: 1,
    ...overrides,
  };
}

class FakeStore implements EmailAttachmentInspectionJobStore {
  claimed: ClaimedEmailAttachmentInspectionJob[] = [];
  claimCalls: Array<{
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }> = [];
  completions: Array<{
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
  }> = [];
  retries: Array<{
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    error: string;
    availableAt: Date;
  }> = [];
  skips: Array<{
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    reason: string;
  }> = [];
  failures: Array<{
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    error: string;
  }> = [];
  transitionResult = true;

  async claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }) {
    this.claimCalls.push(input);
    return this.claimed;
  }

  async markComplete(input: {
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
  }) {
    this.completions.push(input);
    return this.transitionResult;
  }

  async markRetry(input: {
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    error: string;
    availableAt: Date;
  }) {
    this.retries.push(input);
    return this.transitionResult;
  }

  async markSkipped(input: {
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    reason: string;
  }) {
    this.skips.push(input);
    return this.transitionResult;
  }

  async markFailed(input: {
    job: ClaimedEmailAttachmentInspectionJob;
    workerId: string;
    error: string;
  }) {
    this.failures.push(input);
    return this.transitionResult;
  }
}

describe("email attachment inspection worker", () => {
  it("completes, retries, and skips while preserving lease and generation guards", async () => {
    const store = new FakeStore();
    store.claimed = [
      job("complete"),
      job("retry", { attempts: 2 }),
      job("skip"),
    ];
    const now = new Date("2026-07-15T10:00:00.000Z");

    const result = await runEmailAttachmentInspectionWorker(
      {
        store,
        inspect: vi.fn(async (claimed) => {
          if (claimed.id === "retry") {
            return { outcome: "retry" as const, error: "vision busy" };
          }
          if (claimed.id === "skip") {
            return {
              outcome: "skip" as const,
              reason: "unsupported attachment",
            };
          }
          return { outcome: "complete" as const };
        }),
        now: () => now,
        workerId: () => "inspection-worker-1",
      },
      { limit: 10, concurrency: 3, leaseSeconds: 240 }
    );

    expect(store.claimCalls).toEqual([
      { workerId: "inspection-worker-1", limit: 10, leaseSeconds: 240 },
    ]);
    expect(store.completions).toEqual([
      {
        job: expect.objectContaining({ id: "complete", generation: 4 }),
        workerId: "inspection-worker-1",
      },
    ]);
    expect(store.retries).toEqual([
      {
        job: expect.objectContaining({ id: "retry", generation: 4 }),
        workerId: "inspection-worker-1",
        error: "vision busy",
        availableAt: new Date("2026-07-15T10:04:00.000Z"),
      },
    ]);
    expect(store.skips).toEqual([
      {
        job: expect.objectContaining({ id: "skip", generation: 4 }),
        workerId: "inspection-worker-1",
        reason: "unsupported attachment",
      },
    ]);
    expect(result).toEqual({
      claimed: 3,
      completed: 1,
      retrying: 1,
      skipped: 1,
      staleCompletions: 0,
      failed: 0,
      errors: [],
    });
  });

  it("terminalizes and notifies a repeatedly failing inspection after eight attempts", async () => {
    const store = new FakeStore();
    store.claimed = [job("throws", { attempts: 8 })];

    const result = await runEmailAttachmentInspectionWorker({
      store,
      inspect: async () => {
        throw new Error("vision\u0000 temporarily\nunavailable");
      },
      workerId: () => "inspection-worker-2",
    });

    expect(store.retries).toEqual([]);
    expect(store.failures).toEqual([
      {
        job: expect.objectContaining({ id: "throws", generation: 4 }),
        workerId: "inspection-worker-2",
        error: "vision  temporarily unavailable",
      },
    ]);
    expect(result.retrying).toBe(0);
    expect(result.failed).toBe(1);
  });

  it("counts generation or lease races as stale without claiming a terminal state", async () => {
    const store = new FakeStore();
    store.claimed = [job("complete"), job("retry"), job("skip")];
    store.transitionResult = false;

    const result = await runEmailAttachmentInspectionWorker({
      store,
      inspect: async (claimed) => {
        if (claimed.id === "retry") {
          return { outcome: "retry", error: "try later" } as const;
        }
        if (claimed.id === "skip") {
          return { outcome: "skip", reason: "not inspectable" } as const;
        }
        return { outcome: "complete" } as const;
      },
      workerId: () => "inspection-worker-3",
    });

    expect(result).toMatchObject({
      completed: 0,
      retrying: 0,
      skipped: 0,
      staleCompletions: 3,
      failed: 0,
    });
  });

  it("bounds claim size, lease duration, and live inspection concurrency", async () => {
    const store = new FakeStore();
    store.claimed = Array.from({ length: 25 }, (_, index) =>
      job(String(index))
    );
    let active = 0;
    let maximumActive = 0;

    await runEmailAttachmentInspectionWorker(
      {
        store,
        inspect: async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
          active -= 1;
          return { outcome: "complete" };
        },
        workerId: () => "inspection-worker-4",
      },
      { limit: 500, concurrency: 500, leaseSeconds: 2 }
    );

    expect(store.claimCalls).toEqual([
      { workerId: "inspection-worker-4", limit: 50, leaseSeconds: 30 },
    ]);
    expect(maximumActive).toBe(10);
  });

  it("records a durable-transition failure and continues processing", async () => {
    const store = new FakeStore();
    store.claimed = [job("broken"), job("healthy")];
    store.markComplete = vi.fn(async ({ job: claimed }) => {
      if (claimed.id === "broken") throw new Error("write failed");
      return true;
    });

    const result = await runEmailAttachmentInspectionWorker(
      {
        store,
        inspect: async () => ({ outcome: "complete" }),
        workerId: () => "inspection-worker-5",
      },
      { concurrency: 1 }
    );

    expect(result).toEqual({
      claimed: 2,
      completed: 1,
      retrying: 0,
      skipped: 0,
      staleCompletions: 0,
      failed: 1,
      errors: [{ jobId: "broken", error: "write failed" }],
    });
  });

  it("has no provider, Gmail, or sending dependency", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/api/services/email-attachments/attachment-inspection-worker.ts"
      ),
      "utf8"
    );

    expect(source).not.toMatch(
      /email-provider|gmail|EmailService|getProvider/i
    );
    expect(source).not.toMatch(/sendEmail|messages\.send|gatedSend/i);
  });
});
