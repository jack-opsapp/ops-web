import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkPermissionById: vi.fn(),
  queueProjectReminders: vi.fn(),
  runWithSupabase: vi.fn(
    async (_client: unknown, task: () => Promise<unknown>) => task()
  ),
}));

vi.mock("@/app/api/agent/_lib/auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: mocks.checkPermissionById,
}));

vi.mock("@/lib/api/services/payment-reminder-service", () => ({
  PaymentReminderService: {
    queueProjectReminders: mocks.queueProjectReminders,
  },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ kind: "service-role" }),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: mocks.runWithSupabase,
}));

import { POST } from "@/app/api/review/payment/reminder/route";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function request(body: unknown = { projectId: PROJECT_ID }) {
  return new NextRequest("https://app.opsapp.co/api/review/payment/reminder", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/review/payment/reminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      id: "user-1",
      companyId: "company-1",
      role: "operator",
      isManager: false,
      firstName: "Pat",
      lastName: "Lee",
    });
    mocks.checkPermissionById.mockResolvedValue(true);
    mocks.queueProjectReminders.mockResolvedValue({
      eligibleCount: 1,
      queuedCount: 1,
      alreadyQueuedCount: 0,
      failedCount: 0,
    });
  });

  it("rejects an invalid project identifier before permission or draft work", async () => {
    const response = await POST(request({ projectId: "not-a-project-id" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A valid projectId is required",
    });
    expect(mocks.checkPermissionById).not.toHaveBeenCalled();
    expect(mocks.queueProjectReminders).not.toHaveBeenCalled();
  });

  it("fails closed when any required financial mutation permission is absent", async () => {
    mocks.checkPermissionById.mockImplementation(
      async (_userId: string, permission: string) =>
        permission !== "invoices.send"
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.queueProjectReminders).not.toHaveBeenCalled();
  });

  it("queues the real approval-first reminder for the authenticated company", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      eligibleCount: 1,
      queuedCount: 1,
      alreadyQueuedCount: 0,
      failedCount: 0,
    });
    expect(mocks.checkPermissionById).toHaveBeenCalledWith(
      "user-1",
      "projects.edit",
      "all"
    );
    expect(mocks.checkPermissionById).toHaveBeenCalledWith(
      "user-1",
      "invoices.send",
      "all"
    );
    expect(mocks.checkPermissionById).toHaveBeenCalledWith(
      "user-1",
      "finances.view",
      "all"
    );
    expect(mocks.queueProjectReminders).toHaveBeenCalledWith(
      "company-1",
      "user-1",
      PROJECT_ID
    );
    expect(mocks.runWithSupabase).toHaveBeenCalledWith(
      { kind: "service-role" },
      expect.any(Function)
    );
  });

  it("returns a truthful no-eligible response instead of claiming a send", async () => {
    mocks.queueProjectReminders.mockResolvedValue({
      eligibleCount: 0,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "No reminder is due for this project's outstanding invoices",
      eligibleCount: 0,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
    });
  });

  it("reports a duplicate proposal as already queued", async () => {
    mocks.queueProjectReminders.mockResolvedValue({
      eligibleCount: 1,
      queuedCount: 0,
      alreadyQueuedCount: 1,
      failedCount: 0,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eligibleCount: 1,
      queuedCount: 0,
      alreadyQueuedCount: 1,
      failedCount: 0,
    });
  });

  it("reports missing shared-mailbox setup before any draft work", async () => {
    mocks.queueProjectReminders.mockResolvedValue({
      eligibleCount: 1,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
      blockedReason: "mailbox_required",
    });

    const response = await POST(request());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "Connect a company mailbox before queuing reminders",
      blockedReason: "mailbox_required",
    });
  });

  it("keeps the review card retryable after a partial queue failure", async () => {
    mocks.queueProjectReminders.mockResolvedValue({
      eligibleCount: 2,
      queuedCount: 1,
      alreadyQueuedCount: 0,
      failedCount: 1,
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Some payment reminders could not be queued",
      failedCount: 1,
    });
  });

  it("identifies a missing client email instead of reporting no reminder due", async () => {
    mocks.queueProjectReminders.mockResolvedValue({
      eligibleCount: 1,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
      blockedReason: "client_email_required",
    });

    const response = await POST(request());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "Add a client email before queuing reminders",
      blockedReason: "client_email_required",
    });
  });
});
