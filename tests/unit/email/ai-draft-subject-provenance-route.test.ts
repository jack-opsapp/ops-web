import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateDraftMock,
  getServiceRoleClientMock,
  requireEmailCompanyAccessMock,
  setSupabaseOverrideMock,
} = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  requireEmailCompanyAccessMock: vi.fn(),
  setSupabaseOverrideMock: vi.fn(),
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: requireEmailCompanyAccessMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: setSupabaseOverrideMock,
}));

import { POST } from "@/app/api/integrations/email/ai-draft/route";

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
    requireEmailCompanyAccessMock.mockResolvedValue(null);
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
});
