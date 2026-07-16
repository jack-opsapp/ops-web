import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateDraftMock,
  getServiceRoleClientMock,
  resolveEmailOpportunityAccessMock,
  resolveEmailRouteActorMock,
  setSupabaseOverrideMock,
} = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  resolveEmailOpportunityAccessMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
  setSupabaseOverrideMock: vi.fn(),
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: resolveEmailOpportunityAccessMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: setSupabaseOverrideMock,
}));

import { POST } from "@/app/api/integrations/email/ai-draft/route";

const canonicalAccess = {
  allowed: true as const,
  actor: { userId: "user-1", companyId: "company-1" },
  operation: "send" as const,
  threadId: null,
  connectionId: "connection-canonical",
  providerThreadId: null,
  opportunityId: "opportunity-canonical",
  connectionType: "company" as const,
  connectionOwnerId: null,
  pipelineScope: "assigned" as const,
  inboxScope: "assigned" as const,
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

function makeSupabaseDouble() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({
      data: { id: "connection-1" },
      error: null,
    })),
  };

  return { from: vi.fn(() => builder) };
}

describe("POST /api/integrations/email/ai-draft subject provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEmailRouteActorMock.mockResolvedValue({
      ok: true,
      actor: { userId: "user-1", companyId: "company-1" },
    });
    resolveEmailOpportunityAccessMock.mockResolvedValue(canonicalAccess);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble());
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      draftHistoryId: "history-1",
      confidence: 0.9,
      sources: [],
      subject: "Appointment confirmation",
      subjectSource: "configured",
    });
  });

  it("forwards an unchanged template subject as configured, not operator input", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/integrations/email/ai-draft", {
        method: "POST",
        body: JSON.stringify({
          companyId: "company-1",
          userId: "user-1",
          connectionId: "connection-1",
          recipientEmail: "client@example.com",
          configuredSubject: "Appointment confirmation",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(generateDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        configuredSubject: "Appointment confirmation",
      })
    );
    expect(generateDraftMock.mock.calls[0][0].subject).toBeUndefined();
  });

  it("uses only the canonical access projection after authorization", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/integrations/email/ai-draft", {
        method: "POST",
        body: JSON.stringify({
          companyId: "company-1",
          userId: "user-1",
          connectionId: "connection-spoofed",
          opportunityId: "opportunity-spoofed",
          recipientEmail: "unrelated-client@example.com",
          recipientName: "Unrelated Client",
          userInstruction: "Reply about the assigned inquiry",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(generateDraftMock).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-canonical",
      opportunityId: "opportunity-canonical",
      threadId: undefined,
      emailAccess: canonicalAccess,
      userInstruction: "Reply about the assigned inquiry",
      subject: undefined,
      configuredSubject: undefined,
    });
    const request = generateDraftMock.mock.calls[0][0];
    expect(request.recipientEmail).toBeUndefined();
    expect(request.recipientName).toBeUndefined();
  });
});
