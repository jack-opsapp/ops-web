import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeMock, classifyMock, insertMock, updateMock } = vi.hoisted(
  () => ({
    authorizeMock: vi.fn(),
    classifyMock: vi.fn(),
    insertMock: vi.fn(),
    updateMock: vi.fn(),
  })
);

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: authorizeMock,
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { classifyAndUpdate: classifyMock },
  hashParticipants: vi.fn(),
}));

vi.mock("@/lib/types/email-thread", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/types/email-thread")
  >("@/lib/types/email-thread");
  return {
    ...actual,
    mapCategoryCorrectionFromDb: (row: Record<string, unknown>) => ({
      id: row.id,
      companyId: "company-1",
      threadId: "thread-1",
      userId: "actor-1",
      fromCategory: "OTHER",
      toCategory: "VENDOR",
      senderEmail: "bulk@vendor.com",
      senderDomain: "vendor.com",
      participantsHash: null,
      subjectKeywords: [],
      note: null,
      appliedToSimilar: false,
      similarCount: 0,
      createdAt: new Date("2026-07-15T12:00:00.000Z"),
    }),
  };
});

function makeClient() {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.update = (value: unknown) => {
        updateMock(value);
        return builder;
      };
      builder.insert = (value: unknown) => {
        insertMock(value);
        return Promise.resolve({ data: null, error: null });
      };
      builder.single = async () => ({
        data: { id: "correction-1" },
        error: null,
      });
      builder.then = (
        resolve: (value: { data: null; error: null }) => unknown
      ) => Promise.resolve({ data: null, error: null }).then(resolve);
      return builder;
    },
  };
  return { client, tables };
}

const fake = makeClient();

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => fake.client,
}));

import { PhaseCLearningService } from "@/lib/api/services/phase-c-learning-service";

beforeEach(() => {
  vi.clearAllMocks();
  fake.tables.length = 0;
  authorizeMock.mockResolvedValue({ allowed: true });
});

describe("Phase C correction isolation", () => {
  it("defers similar-thread reclassification instead of scanning the company inbox", async () => {
    const result = await PhaseCLearningService.applyCorrectionToSimilar({
      correctionId: "correction-1",
      actorUserId: "actor-1",
    });

    expect(authorizeMock).toHaveBeenCalledWith({
      actor: { userId: "actor-1", companyId: "company-1" },
      operation: "edit",
      threadId: "thread-1",
      supabase: fake.client,
    });
    expect(fake.tables).not.toContain("email_threads");
    expect(classifyMock).not.toHaveBeenCalled();
    expect(result).toEqual({ reclassified: 0 });
    expect(updateMock).toHaveBeenCalledWith({
      applied_to_similar: true,
      similar_count: 0,
    });
  });

  it("fails closed when the correction actor no longer has canonical lead/inbox access", async () => {
    authorizeMock.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });

    const result = await PhaseCLearningService.applyCorrectionToSimilar({
      correctionId: "correction-1",
      actorUserId: "actor-1",
    });

    expect(result).toEqual({ reclassified: 0 });
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("rejects a caller that does not match the persisted correction actor", async () => {
    const result = await PhaseCLearningService.applyCorrectionToSimilar({
      correctionId: "correction-1",
      actorUserId: "actor-2",
    });

    expect(result).toEqual({ reclassified: 0 });
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
