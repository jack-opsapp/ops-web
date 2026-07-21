import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runWithEmailConnectionSyncLockMock } = vi.hoisted(() => ({
  runWithEmailConnectionSyncLockMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: runWithEmailConnectionSyncLockMock,
}));

import { applyEmailProviderLabelWriteback } from "@/lib/api/services/email-provider-label-writeback";

beforeEach(() => {
  vi.clearAllMocks();
  runWithEmailConnectionSyncLockMock.mockImplementation(
    async ({
      run,
    }: {
      run: (checkpoint: ReturnType<typeof vi.fn>) => unknown;
    }) => {
      const checkpoint = vi.fn(async () => undefined);
      return { acquired: true, value: await run(checkpoint) };
    }
  );
});

describe("applyEmailProviderLabelWriteback", () => {
  it("fails busy without applying a provider label", async () => {
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });
    const applyLabel = vi.fn();

    await expect(
      applyEmailProviderLabelWriteback({
        supabase: {} as never,
        connectionId: "connection-1",
        providerThreadId: "thread-1",
        providerLabelId: "label-1",
        provider: { applyLabel },
        context: "email-send-label-writeback",
        busyError: "EMAIL_SEND_LABEL_MAILBOX_BUSY",
      })
    ).rejects.toThrow("EMAIL_SEND_LABEL_MAILBOX_BUSY");

    expect(applyLabel).not.toHaveBeenCalled();
  });

  it("checkpoints around provider mutation under the physical-mailbox lease", async () => {
    const events: string[] = [];
    const checkpoint = vi.fn(async () => {
      events.push("checkpoint");
    });
    const applyLabel = vi.fn(async () => {
      events.push("apply");
    });
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({ run }: { run: (renew: typeof checkpoint) => unknown }) => ({
        acquired: true,
        value: await run(checkpoint),
      })
    );

    await expect(
      applyEmailProviderLabelWriteback({
        supabase: {} as never,
        connectionId: "connection-1",
        providerThreadId: "thread-1",
        providerLabelId: "label-1",
        provider: { applyLabel },
        context: "email-send-label-writeback",
        busyError: "EMAIL_SEND_LABEL_MAILBOX_BUSY",
      })
    ).resolves.toBe("applied");

    expect(events).toEqual(["checkpoint", "apply", "checkpoint"]);
  });

  it("reuses a caller-owned lease without nested acquisition", async () => {
    const checkpoint = vi.fn(async () => undefined);
    const applyLabel = vi.fn(async () => undefined);

    await applyEmailProviderLabelWriteback({
      supabase: {} as never,
      connectionId: "connection-1",
      providerThreadId: "thread-1",
      providerLabelId: "label-1",
      provider: { applyLabel },
      context: "email-send-label-writeback",
      busyError: "EMAIL_SEND_LABEL_MAILBOX_BUSY",
      providerLockCheckpoint: checkpoint,
    });

    expect(runWithEmailConnectionSyncLockMock).not.toHaveBeenCalled();
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(applyLabel).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      path: "src/lib/api/services/email-send-reconciliation-service.ts",
      busyError: "EMAIL_SEND_LABEL_MAILBOX_BUSY",
    },
    {
      path: "src/lib/api/services/approved-action-email-reconciliation-service.ts",
      busyError: "APPROVED_ACTION_EMAIL_LABEL_MAILBOX_BUSY",
    },
  ])(
    "routes post-send label mutation through the mailbox lease in $path",
    ({ path, busyError }) => {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source).toContain("applyEmailProviderLabelWriteback");
      expect(source).toContain(busyError);
      expect(source).not.toMatch(/provider\.applyLabel\s*\(/);
    }
  );
});
