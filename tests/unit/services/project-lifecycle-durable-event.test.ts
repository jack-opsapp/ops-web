import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existingNote: null as { id: string } | null,
  createSystemEvent: vi.fn(),
  dispatchNotificationEvent: vi.fn(),
}));

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: { createSystemEvent: mocks.createSystemEvent },
}));
vi.mock("@/lib/notifications/dispatch-notification-event", () => ({
  dispatchNotificationEvent: mocks.dispatchNotificationEvent,
}));
vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: vi.fn(async () => false),
  },
}));

function query(result: () => { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is", "contains"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result());
  return builder;
}

const db = {
  from: vi.fn((table: string) => {
    if (table === "project_notes") {
      return query(() => ({ data: mocks.existingNote, error: null }));
    }
    if (table === "projects") {
      return query(() => ({
        data: { status: "estimated", status_version: 4 },
        error: null,
      }));
    }
    throw new Error(`Unexpected table: ${table}`);
  }),
};

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => db,
  parseDate: (value: string | null) => (value ? new Date(value) : null),
  parseDateRequired: (value: string) => new Date(value),
}));

import { ProjectLifecycleService } from "@/lib/api/services/project-lifecycle-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existingNote = null;
  mocks.createSystemEvent.mockResolvedValue({ id: "note-1" });
  mocks.dispatchNotificationEvent.mockResolvedValue({
    ok: true,
    notified: 1,
    pushed: 1,
    emailed: 0,
  });
});

describe("durable project lifecycle events", () => {
  it("writes a stable lifecycle proof used by notification dedupe", async () => {
    await ProjectLifecycleService.onProjectStageChange(
      "company-1",
      "project-1",
      "rfq",
      "estimated",
      "actor-1",
      "Jason Zavarella",
      "event-1",
      true,
      4
    );

    expect(mocks.createSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "status_change",
        contentMetadata: {
          from: "rfq",
          to: "estimated",
          lifecycle_event_id: "event-1",
          lifecycle_status_version: 4,
        },
      })
    );
    expect(mocks.dispatchNotificationEvent).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchNotificationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          eventType: "project_status_change",
          projectId: "project-1",
          projectStatusEventId: "event-1",
        },
      })
    );
  });

  it("reuses an existing lifecycle proof on retry", async () => {
    mocks.existingNote = { id: "note-1" };

    await ProjectLifecycleService.onProjectStageChange(
      "company-1",
      "project-1",
      "rfq",
      "estimated",
      "actor-1",
      "Jason Zavarella",
      "event-1",
      true,
      4
    );

    expect(mocks.createSystemEvent).not.toHaveBeenCalled();
    expect(mocks.dispatchNotificationEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps the outbox retryable when timeline persistence fails", async () => {
    mocks.createSystemEvent.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      ProjectLifecycleService.onProjectStageChange(
        "company-1",
        "project-1",
        "rfq",
        "estimated",
        "actor-1",
        "Jason Zavarella",
        "event-1",
        true,
        4
      )
    ).rejects.toThrow("write failed");
    expect(mocks.dispatchNotificationEvent).not.toHaveBeenCalled();
  });

  it("keeps the outbox retryable when notification persistence fails", async () => {
    mocks.dispatchNotificationEvent.mockResolvedValueOnce({
      ok: false,
      status: 500,
      reason: "Notification persistence failed",
    });

    await expect(
      ProjectLifecycleService.onProjectStageChange(
        "company-1",
        "project-1",
        "rfq",
        "estimated",
        "actor-1",
        "Jason Zavarella",
        "event-1",
        true,
        4
      )
    ).rejects.toThrow("Notification persistence failed");
  });

  it("suppresses stale ABA events whose status matches but version does not", async () => {
    await ProjectLifecycleService.onProjectStageChange(
      "company-1",
      "project-1",
      "rfq",
      "estimated",
      "actor-1",
      "Jason Zavarella",
      "event-old",
      true,
      2
    );

    expect(mocks.createSystemEvent).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchNotificationEvent).not.toHaveBeenCalled();
  });

  it("keeps exact-proof notification conflicts retryable", async () => {
    mocks.dispatchNotificationEvent.mockResolvedValueOnce({
      ok: false,
      status: 409,
      reason: "Missing status event",
    });

    await expect(
      ProjectLifecycleService.onProjectStageChange(
        "company-1",
        "project-1",
        "rfq",
        "estimated",
        "actor-1",
        "Jason Zavarella",
        "event-1",
        true,
        4
      )
    ).rejects.toThrow("Missing status event");
  });
});
