import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getServiceRoleClientMock,
  runSupabaseEmailAssignmentContactFormDraftWorkerMock,
  runSupabaseEmailConversionPhotoWorkerMock,
  runSupabaseEmailAttachmentWorkerMock,
  runWithCronWorkloadControlMock,
  isDatabasePressureErrorMock,
  runWithSupabaseMock,
  serviceRoleClient,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  runSupabaseEmailAssignmentContactFormDraftWorkerMock: vi.fn(),
  runSupabaseEmailConversionPhotoWorkerMock: vi.fn(),
  runSupabaseEmailAttachmentWorkerMock: vi.fn(),
  runWithCronWorkloadControlMock: vi.fn(),
  isDatabasePressureErrorMock: vi.fn(),
  runWithSupabaseMock: vi.fn(),
  serviceRoleClient: { kind: "service-role-client" },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: runWithSupabaseMock,
}));

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError: class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
      this.name = "CronDatabaseOperationError";
    }
  },
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
  isDatabasePressureError: isDatabasePressureErrorMock,
}));

vi.mock("@/lib/api/services/email-attachments/attachment-runtime", () => ({
  runSupabaseEmailAttachmentWorker: runSupabaseEmailAttachmentWorkerMock,
}));

vi.mock("@/lib/api/services/email-conversion-photo-runtime", () => ({
  runSupabaseEmailConversionPhotoWorker:
    runSupabaseEmailConversionPhotoWorkerMock,
}));

vi.mock(
  "@/lib/api/services/email-assignment-contact-form-draft-runtime",
  () => ({
    runSupabaseEmailAssignmentContactFormDraftWorker:
      runSupabaseEmailAssignmentContactFormDraftWorkerMock,
  })
);

import { GET } from "@/app/api/cron/email-attachment-worker/route";

const emptyResult = {
  claimed: 0,
  completed: 0,
  retrying: 0,
  paused: 0,
  staleCompletions: 0,
  failed: 0,
  errors: [],
};

const emptyPhotoResult = {
  claimed: 0,
  completed: 0,
  retrying: 0,
  skipped: 0,
  failed: 0,
  staleCompletions: 0,
  cleanupClaimed: 0,
  cleanupCompleted: 0,
  cleanupRetrying: 0,
  errors: [],
};

const emptyAssignmentDraftResult = {
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

function request(secret = "cron-test-secret"): NextRequest {
  return new NextRequest("https://ops.test/api/cron/email-attachment-worker", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("email attachment worker cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    getServiceRoleClientMock.mockReset();
    getServiceRoleClientMock.mockReturnValue(serviceRoleClient);
    runSupabaseEmailAttachmentWorkerMock.mockReset();
    runSupabaseEmailAttachmentWorkerMock.mockResolvedValue(emptyResult);
    runSupabaseEmailConversionPhotoWorkerMock.mockReset();
    runSupabaseEmailConversionPhotoWorkerMock.mockResolvedValue(
      emptyPhotoResult
    );
    runSupabaseEmailAssignmentContactFormDraftWorkerMock.mockReset();
    runSupabaseEmailAssignmentContactFormDraftWorkerMock.mockResolvedValue(
      emptyAssignmentDraftResult
    );
    runWithCronWorkloadControlMock.mockReset();
    runWithCronWorkloadControlMock.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => ({
        status: "completed",
        value: await work(),
      })
    );
    isDatabasePressureErrorMock.mockReset();
    isDatabasePressureErrorMock.mockImplementation((error: unknown) =>
      /PGRST002|57014|connection timeout|SSL handshake failed|web server is down|\b52[125]\b/i.test(
        String(
          error &&
            typeof error === "object" &&
            "error" in error &&
            typeof error.error === "string"
            ? error.error
            : error
        )
      )
    );
    runWithSupabaseMock.mockReset();
    runWithSupabaseMock.mockImplementation(
      async (_client: unknown, work: () => Promise<unknown>) => work()
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("fails closed when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "CRON_SECRET not configured",
    });
    expect(getServiceRoleClientMock).not.toHaveBeenCalled();
    expect(runSupabaseEmailAttachmentWorkerMock).not.toHaveBeenCalled();
    expect(runSupabaseEmailConversionPhotoWorkerMock).not.toHaveBeenCalled();
    expect(
      runSupabaseEmailAssignmentContactFormDraftWorkerMock
    ).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token before creating a service client", async () => {
    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Unauthorized",
    });
    expect(getServiceRoleClientMock).not.toHaveBeenCalled();
    expect(runSupabaseEmailAttachmentWorkerMock).not.toHaveBeenCalled();
    expect(runSupabaseEmailConversionPhotoWorkerMock).not.toHaveBeenCalled();
    expect(
      runSupabaseEmailAssignmentContactFormDraftWorkerMock
    ).not.toHaveBeenCalled();
  });

  it("runs the worker inside the service-role Supabase context", async () => {
    const result = { ...emptyResult, claimed: 2, completed: 2 };
    runSupabaseEmailAttachmentWorkerMock.mockResolvedValue(result);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ...result,
      conversionPhotos: emptyPhotoResult,
      assignmentContactFormDrafts: emptyAssignmentDraftResult,
    });
    expect(runWithSupabaseMock).toHaveBeenCalledWith(
      serviceRoleClient,
      expect.any(Function)
    );
    expect(runWithCronWorkloadControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceRoleClient,
        workloadKey: "attachment-maintenance",
        leaseSeconds: 360,
        work: expect.any(Function),
      })
    );
    expect(runSupabaseEmailAttachmentWorkerMock).toHaveBeenCalledWith(
      serviceRoleClient,
      {
        limit: 3,
        concurrency: 1,
        leaseSeconds: 360,
        inspectionLimit: 3,
        inspectionConcurrency: 1,
      }
    );
    expect(runSupabaseEmailConversionPhotoWorkerMock).toHaveBeenCalledWith(
      serviceRoleClient,
      { limit: 2, leaseSeconds: 360 }
    );
    expect(
      runSupabaseEmailAssignmentContactFormDraftWorkerMock
    ).toHaveBeenCalledWith(serviceRoleClient, {
      leaseSeconds: 360,
      limit: 1,
    });
  });

  it("returns 503 when the worker reports one or more failures", async () => {
    const result = {
      ...emptyResult,
      claimed: 1,
      failed: 1,
      errors: [{ scanId: "scan-1", error: "storage unavailable" }],
    };
    runSupabaseEmailAttachmentWorkerMock.mockResolvedValue(result);

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      ...result,
      conversionPhotos: emptyPhotoResult,
      assignmentContactFormDrafts: emptyAssignmentDraftResult,
    });
  });

  it("stops before later pipelines when a worker reports database pressure", async () => {
    runSupabaseEmailAttachmentWorkerMock.mockResolvedValue({
      ...emptyResult,
      claimed: 1,
      failed: 1,
      errors: [
        {
          scanId: "scan-1",
          error: "PGRST002: could not query the database for the schema cache",
        },
      ],
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(runSupabaseEmailConversionPhotoWorkerMock).not.toHaveBeenCalled();
    expect(
      runSupabaseEmailAssignmentContactFormDraftWorkerMock
    ).not.toHaveBeenCalled();
  });

  it("stops before later pipelines when attachment inspection reports nested database pressure", async () => {
    runSupabaseEmailAttachmentWorkerMock.mockResolvedValue({
      ...emptyResult,
      claimed: 1,
      failed: 1,
      inspection: {
        claimed: 1,
        completed: 0,
        retrying: 0,
        skipped: 0,
        staleCompletions: 0,
        failed: 1,
        errors: [
          {
            jobId: "inspection-1",
            error:
              "PGRST002: could not query the database for the schema cache",
          },
        ],
      },
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(runSupabaseEmailConversionPhotoWorkerMock).not.toHaveBeenCalled();
    expect(
      runSupabaseEmailAssignmentContactFormDraftWorkerMock
    ).not.toHaveBeenCalled();
  });

  it("returns 503 when converted-project photo materialization fails", async () => {
    const photoResult = {
      ...emptyPhotoResult,
      claimed: 1,
      failed: 1,
      errors: [{ jobId: "photo-job-1", error: "storage unavailable" }],
    };
    runSupabaseEmailConversionPhotoWorkerMock.mockResolvedValue(photoResult);

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      ...emptyResult,
      conversionPhotos: photoResult,
      assignmentContactFormDrafts: emptyAssignmentDraftResult,
    });
  });

  it("returns 503 when photo reconciliation reports an unrecorded queue error", async () => {
    const photoResult = {
      ...emptyPhotoResult,
      claimed: 1,
      errors: [
        {
          objectId: "photo-object-1",
          error: "cleanup queue update unavailable",
        },
      ],
    };
    runSupabaseEmailConversionPhotoWorkerMock.mockResolvedValue(photoResult);

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      ...emptyResult,
      conversionPhotos: photoResult,
      assignmentContactFormDrafts: emptyAssignmentDraftResult,
    });
  });

  it("returns 503 when assignment-triggered contact-form draft processing fails", async () => {
    const draftResult = {
      ...emptyAssignmentDraftResult,
      claimed: 1,
      failed: 1,
      errors: [{ queueId: "draft-job-1", error: "provider unavailable" }],
    };
    runSupabaseEmailAssignmentContactFormDraftWorkerMock.mockResolvedValue(
      draftResult
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      ...emptyResult,
      conversionPhotos: emptyPhotoResult,
      assignmentContactFormDrafts: draftResult,
    });
  });

  it("returns a retryable failure response when the worker throws", async () => {
    runSupabaseEmailAttachmentWorkerMock.mockRejectedValue(
      new Error("claim failed")
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "claim failed",
    });
    expect(runSupabaseEmailConversionPhotoWorkerMock).not.toHaveBeenCalled();
    expect(
      runSupabaseEmailAssignmentContactFormDraftWorkerMock
    ).not.toHaveBeenCalled();
  });

  it("uses isolated offsets without replacing existing crons", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")
    ) as {
      crons: Array<{ path: string; schedule: string }>;
    };

    expect(config.crons).toContainEqual({
      path: "/api/cron/email-attachment-worker",
      schedule: "3-59/20 * * * *",
    });
    expect(config.crons).toContainEqual({
      path: "/api/cron/email-sync",
      schedule: "4-59/20 13-23,0-4 * * *",
    });
    expect(config.crons).toContainEqual({
      path: "/api/cron/email/worker",
      schedule: "13-59/20 13-23,0-4 * * *",
    });
  });

  it("launches no attachment work while another heavy workload holds the lease", async () => {
    runWithCronWorkloadControlMock.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(runSupabaseEmailAttachmentWorkerMock).not.toHaveBeenCalled();
    expect(runSupabaseEmailConversionPhotoWorkerMock).not.toHaveBeenCalled();
    expect(
      runSupabaseEmailAssignmentContactFormDraftWorkerMock
    ).not.toHaveBeenCalled();
  });

  it("fails closed when attachment workload control is unavailable", async () => {
    runWithCronWorkloadControlMock.mockResolvedValue({
      status: "skipped",
      reason: "control_unavailable",
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      ran: false,
      reason: "control_unavailable",
    });
    expect(runSupabaseEmailAttachmentWorkerMock).not.toHaveBeenCalled();
  });
});
