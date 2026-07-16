import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evaluateOpportunityAcceptanceMock,
  getConnectionMock,
  getProviderMock,
  runScanWorkerMock,
  runInspectionWorkerMock,
} = vi.hoisted(() => ({
  evaluateOpportunityAcceptanceMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  runScanWorkerMock: vi.fn(),
  runInspectionWorkerMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-attachments/attachment-worker", () => ({
  runEmailAttachmentWorker: runScanWorkerMock,
}));

vi.mock(
  "@/lib/api/services/email-attachments/attachment-inspection-worker",
  () => ({
    runEmailAttachmentInspectionWorker: runInspectionWorkerMock,
  })
);

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/conversation-state/acceptance-evaluation", () => ({
  evaluateOpportunityAcceptance: evaluateOpportunityAcceptanceMock,
}));

vi.mock("@/lib/api/services/conversation-state/operator-identity", () => ({
  fetchOperatorIdentity: vi.fn(),
}));

vi.mock("@/lib/api/services/conversation-state/attachment-inspector", () => ({
  classifyInspectableAttachment: vi.fn(),
  inspectImageContent: vi.fn(),
  inspectPdfContent: vi.fn(),
  planAttachmentInspections: vi.fn(),
}));

import {
  SupabaseAttachmentInspectionQueue,
  ingestExactActivityAttachments,
  notifyAttachmentCopyExceptions,
  runSupabaseEmailAttachmentInspectionWorker,
  runSupabaseEmailAttachmentWorker,
} from "@/lib/api/services/email-attachments/attachment-runtime";
import { ProviderAuthError } from "@/lib/api/services/email-provider";

const scanResult = {
  claimed: 2,
  completed: 2,
  retrying: 0,
  paused: 0,
  staleCompletions: 0,
  failed: 0,
  errors: [],
};

const inspectionResult = {
  claimed: 1,
  completed: 0,
  retrying: 1,
  skipped: 0,
  staleCompletions: 0,
  failed: 0,
  errors: [],
};

beforeEach(() => {
  evaluateOpportunityAcceptanceMock.mockReset();
  evaluateOpportunityAcceptanceMock.mockResolvedValue({ stageChanged: false });
  getConnectionMock.mockReset();
  getProviderMock.mockReset();
  runScanWorkerMock.mockReset();
  runScanWorkerMock.mockResolvedValue(scanResult);
  runInspectionWorkerMock.mockReset();
  runInspectionWorkerMock.mockResolvedValue(inspectionResult);
});

describe("Supabase attachment runtime orchestration", () => {
  it("finishes file scans independently while the inspection queue retries", async () => {
    const supabase = {} as never;

    const result = await runSupabaseEmailAttachmentWorker(supabase, {
      limit: 8,
      concurrency: 2,
      inspectionLimit: 4,
      inspectionConcurrency: 1,
      leaseSeconds: 180,
    });

    expect(runScanWorkerMock).toHaveBeenCalledTimes(1);
    expect(runInspectionWorkerMock).toHaveBeenCalledTimes(1);
    expect(runInspectionWorkerMock).toHaveBeenCalledWith(
      expect.objectContaining({ inspect: expect.any(Function) }),
      { limit: 4, concurrency: 1, leaseSeconds: 180 }
    );
    expect(result).toEqual({
      ...scanResult,
      failed: 0,
      inspection: inspectionResult,
    });
  });

  it("records a durable inspection job without invoking storage or a provider", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      expect(table).toBe("email_attachment_inspection_jobs");
      return { upsert };
    });
    const queue = new SupabaseAttachmentInspectionQueue(
      { from } as never,
      {
        id: "connection-1",
        companyId: "company-1",
      } as never
    );

    await queue.enqueueCanonicalAttachment({
      canonicalAttachmentId: "attachment-row-1",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: "company-1",
        connection_id: "connection-1",
        email_attachment_id: "attachment-row-1",
        status: "pending",
      }),
      { onConflict: "email_attachment_id", ignoreDuplicates: true }
    );
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("reevaluates acceptance after a cron-owned canonical inspection completes", async () => {
    const connection = {
      id: "connection-1",
      companyId: "company-1",
      userId: "user-1",
      email: "ops@example.com",
    } as never;
    getConnectionMock.mockResolvedValue(connection);

    runInspectionWorkerMock.mockImplementationOnce(async ({ inspect }) => {
      const outcome = await inspect({
        id: "inspection-job-1",
        companyId: "company-1",
        connectionId: "connection-1",
        emailAttachmentId: "attachment-row-1",
        generation: 1,
        attempts: 1,
      });
      expect(outcome).toEqual({ outcome: "complete" });
      return inspectionResult;
    });

    const attachmentQuery: Record<string, unknown> = {};
    Object.assign(attachmentQuery, {
      select: vi.fn(() => attachmentQuery),
      eq: vi.fn(() => attachmentQuery),
      maybeSingle: vi.fn(async () => ({
        data: {
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          opportunity_id: "opportunity-1",
          attribution_status: "attributed",
        },
        error: null,
      })),
    });
    const inspectionQuery: Record<string, unknown> = {};
    Object.assign(inspectionQuery, {
      select: vi.fn(() => inspectionQuery),
      eq: vi.fn(() => inspectionQuery),
      limit: vi.fn(async () => ({
        data: [{ id: "inspection-1" }],
        error: null,
      })),
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "email_attachments") return attachmentQuery;
        if (table === "attachment_inspections") return inspectionQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never;

    await runSupabaseEmailAttachmentInspectionWorker(supabase, {
      limit: 1,
      concurrency: 1,
    });

    expect(evaluateOpportunityAcceptanceMock).toHaveBeenCalledWith({
      supabase,
      connection,
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
    });
  });

  it("requests a server-derived attachment recipient when files cannot be copied", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const query: Record<string, unknown> = {};
    Object.assign(query, {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: { id: "thread-row-1" },
        error: null,
      })),
    });
    const supabase = {
      from: vi.fn(() => query),
      rpc,
    } as never;

    await notifyAttachmentCopyExceptions(supabase, "scan-1", {
      activityId: "activity-1",
      discovered: 3,
      stored: 1,
      externalReferences: 1,
      oversized: 1,
      unavailable: 0,
      failed: 1,
      retryPending: 0,
      requiresRetry: false,
      canonicalUrls: [],
    });

    expect(rpc).toHaveBeenCalledWith(
      "notify_email_attachment_scan_exception_as_system",
      { p_scan_id: "scan-1" }
    );
  });

  it("atomically parks and notifies a mailbox when attachment-only auth fails", async () => {
    const connectionId = "00000000-0000-4000-8000-000000000001";
    getProviderMock.mockReturnValue({
      getAttachmentsFromMessage: vi
        .fn()
        .mockRejectedValue(new ProviderAuthError("Mailbox access revoked")),
    });

    const activityQuery: Record<string, unknown> = {};
    Object.assign(activityQuery, {
      select: vi.fn(() => activityQuery),
      eq: vi.fn(() => activityQuery),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "activity-1",
          company_id: "company-1",
          email_connection_id: connectionId,
          email_message_id: "message-1",
          email_thread_id: "thread-1",
          opportunity_id: null,
          direction: "inbound",
          from_email: "client@example.com",
          to_emails: ["ops@example.com"],
          match_needs_review: false,
          created_at: "2026-07-15T00:00:00.000Z",
        },
        error: null,
      })),
    });

    const connectionUpdate: Record<string, unknown> = {};
    Object.assign(connectionUpdate, {
      update: vi.fn(() => connectionUpdate),
      eq: vi.fn(() => connectionUpdate),
      select: vi.fn(async () => ({
        data: [{ id: connectionId }],
        error: null,
      })),
    });

    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    const from = vi.fn((table: string) => {
      if (table === "activities") return activityQuery;
      if (table === "email_connections") return connectionUpdate;
      throw new Error(`Unexpected table: ${table}`);
    });
    const supabase = { from, rpc } as never;

    await expect(
      ingestExactActivityAttachments(
        supabase,
        {
          id: connectionId,
          companyId: "company-1",
          userId: null,
          email: "ops@example.com",
          status: "active",
          syncEnabled: true,
        } as never,
        {
          activityId: "activity-1",
          companyId: "company-1",
          connectionId,
          messageId: "message-1",
        }
      )
    ).rejects.toThrow(ProviderAuthError);

    expect(rpc).toHaveBeenCalledWith(
      "mark_email_connection_needs_reconnect_as_system",
      { p_connection_id: connectionId }
    );
  });
});
