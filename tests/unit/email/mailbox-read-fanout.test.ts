import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

const { getProviderMock } = vi.hoisted(() => ({
  getProviderMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getProvider: getProviderMock,
  },
}));

import { PatternDetectionService } from "@/lib/api/services/pattern-detection-service";

describe("mailbox-wide provider read fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("honors the caller's shared deadline before starting a Gmail search", async () => {
    const now = new Date();
    const connection: EmailConnection = {
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      type: "company",
      userId: null,
      email: "operator@example.com",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      historyId: "history-start",
      syncEnabled: true,
      lastSyncedAt: null,
      syncIntervalMinutes: 5,
      syncFilters: {},
      webhookSubscriptionId: null,
      webhookExpiresAt: null,
      opsLabelId: null,
      aiReviewEnabled: false,
      aiMemoryEnabled: false,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ messages: [] }), {
          headers: { "content-type": "application/json" },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(connection).searchEmails("in:sent", {
        maxResults: 1,
        readPolicy: {
          deadlineAt: Date.now() - 1,
          context: "shared pattern detection deadline",
        },
      })
    ).rejects.toMatchObject({
      name: "ProviderApiError",
      providerStatus: 504,
      providerBody: { reason: "gmail_read_deadline_exceeded" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serializes pattern detection searches under one absolute read deadline", async () => {
    let activeSearches = 0;
    let maxActiveSearches = 0;
    const readPolicies: unknown[] = [];
    const searchEmails = vi.fn(
      async (
        _query: string,
        options?: { readPolicy?: { deadlineAt?: number; context?: string } }
      ) => {
        activeSearches += 1;
        maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
        readPolicies.push(options?.readPolicy);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeSearches -= 1;
        return [];
      }
    );
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      searchEmails,
    });
    const providerLockCheckpoint = vi.fn().mockResolvedValue(undefined);

    await PatternDetectionService.detect(
      {
        id: "connection-1",
        companyId: "company-1",
        email: "operator@example.com",
      } as never,
      { monthsBack: 3, providerLockCheckpoint }
    );

    expect(searchEmails).toHaveBeenCalledTimes(3);
    expect(providerLockCheckpoint.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(maxActiveSearches).toBe(1);
    expect(
      readPolicies.every(
        (policy) =>
          typeof (policy as { deadlineAt?: unknown } | undefined)
            ?.deadlineAt === "number"
      )
    ).toBe(true);
    expect(
      new Set(
        readPolicies.map(
          (policy) => (policy as { deadlineAt: number }).deadlineAt
        )
      ).size
    ).toBe(1);
  });

  it("runs one durable draft sweep on both sync checkpoint paths", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
      "utf8"
    );

    expect(
      source.match(
        /\n\s+await reconcilePendingMailboxDraftsForConnection\(/g
      ) ?? []
    ).toHaveLength(2);
    expect(source).not.toContain("reconcilePendingMailboxDrafts({");
    expect(source).not.toMatch(
      /reconcilePendingMailboxDraftsForConnection\([\s\S]{0,300}\.catch\(/
    );

    const emptyCheckpointStart = source.indexOf(
      "if (rawInboxEmails.length === 0 && rawSentEmails.length === 0)"
    );
    const emptyCheckpointPath = source.slice(
      emptyCheckpointStart,
      source.indexOf("profile.internalPhones", emptyCheckpointStart)
    );
    expect(
      emptyCheckpointPath.indexOf("reconcilePendingMailboxDraftsForConnection")
    ).toBeGreaterThan(-1);
    expect(
      emptyCheckpointPath.indexOf("reconcilePendingMailboxDraftsForConnection")
    ).toBeLessThan(emptyCheckpointPath.indexOf("persistSyncCheckpoint"));
    expect(emptyCheckpointPath).toContain(
      "providerLockCheckpoint: renewSyncLeaseIfNeeded"
    );

    const populatedCheckpointPath = source.slice(
      source.indexOf("for (const item of processingQueue)"),
      source.indexOf("// Step 5: AI classification")
    );
    expect(populatedCheckpointPath).toContain(
      "await reconcilePendingMailboxDraftsForConnection("
    );
    expect(populatedCheckpointPath).toContain(
      "providerLockCheckpoint: renewSyncLeaseIfNeeded"
    );
  });

  it("threads the owning mailbox checkpoint through pattern and stage review reads", () => {
    const analyzeSource = readFileSync(
      join(process.cwd(), "src/app/api/integrations/email/analyze/route.ts"),
      "utf8"
    );
    const syncSource = readFileSync(
      join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
      "utf8"
    );
    const patternSource = readFileSync(
      join(process.cwd(), "src/lib/api/services/pattern-detection-service.ts"),
      "utf8"
    );
    const reviewerSource = readFileSync(
      join(process.cwd(), "src/lib/api/services/ai-sync-reviewer.ts"),
      "utf8"
    );
    const reconciliationSource = readFileSync(
      join(process.cwd(), "src/lib/api/services/draft-reconciliation.ts"),
      "utf8"
    );

    expect(analyzeSource).toContain("providerLockCheckpoint,");
    expect(syncSource).toMatch(
      /evaluateStagesWithSummary\([\s\S]{0,400}providerLockCheckpoint: renewSyncLeaseIfNeeded/
    );
    for (const source of [
      patternSource,
      reviewerSource,
      reconciliationSource,
    ]) {
      expect(source).toContain("runEmailProviderMailboxOperation");
      expect(source).toContain("providerLockCheckpoint");
    }
  });
});
