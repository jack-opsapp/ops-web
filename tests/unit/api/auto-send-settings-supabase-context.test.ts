// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  anonymousClient: { kind: "anonymous-browser-client" },
  getServiceRoleClient: vi.fn(),
  resolveAccess: vi.fn(),
  isFeatureEnabled: vi.fn(),
  getCategoryAutonomy: vi.fn(),
  getConfidence: vi.fn(),
  autoSendIsEnabled: vi.fn(),
  updateSettings: vi.fn(),
  validateTransition: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => mocks.anonymousClient,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("@/lib/email/phase-c-category-settings-access", () => ({
  resolvePhaseCCategorySettingsAccess: mocks.resolveAccess,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: mocks.isFeatureEnabled,
  },
}));

vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: {
    get: mocks.getCategoryAutonomy,
  },
}));

vi.mock("@/lib/api/services/writing-profile-service", () => ({
  WritingProfileService: {
    getConfidence: mocks.getConfidence,
  },
}));

vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: {
    isEnabled: mocks.autoSendIsEnabled,
    updateSettings: mocks.updateSettings,
  },
}));

vi.mock("@/lib/email/email-auto-send-settings-guard", () => ({
  validateAutoSendSettingsTransition: mocks.validateTransition,
}));

import { GET } from "@/app/api/integrations/email/auto-send/settings/route";
import { requireSupabase } from "@/lib/supabase/helpers";

type QueryResult = {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  error: null;
};

function queryBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

function serviceRoleClient(kind: string) {
  return {
    kind,
    from: vi.fn((table: string) => {
      if (table === "email_connections") {
        return queryBuilder({ data: { auto_send_settings: {} }, error: null });
      }
      if (table === "agent_writing_profiles") {
        return queryBuilder({ data: [], error: null });
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function request(connectionId: string) {
  const url = new URL(
    "https://ops.test/api/integrations/email/auto-send/settings"
  );
  url.searchParams.set("companyId", "company-1");
  url.searchParams.set("connectionId", connectionId);
  return new NextRequest(url);
}

describe("auto-send settings Supabase context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureEnabled.mockResolvedValue(false);
    mocks.getConfidence.mockReturnValue(0);
  });

  it("keeps the first service-role client after an overlapping request finishes", async () => {
    const firstClient = serviceRoleClient("first-service-role-client");
    const secondClient = serviceRoleClient("second-service-role-client");
    mocks.getServiceRoleClient
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient);

    let markFirstPaused: (() => void) | undefined;
    const firstPaused = new Promise<void>((resolve) => {
      markFirstPaused = resolve;
    });
    let resumeFirst: (() => void) | undefined;
    const firstMayResume = new Promise<void>((resolve) => {
      resumeFirst = resolve;
    });

    mocks.resolveAccess.mockImplementation(
      async ({ connectionId }: { connectionId: string }) => {
        if (connectionId === "connection-first") {
          markFirstPaused?.();
          await firstMayResume;
        }
        return {
          allowed: true,
          actor: { userId: "actor-1", companyId: "company-1" },
        };
      }
    );
    mocks.getCategoryAutonomy.mockImplementation(async () => {
      const client = requireSupabase() as unknown as { kind: string };
      if (client === mocks.anonymousClient) {
        const error = new Error(
          "permission denied for table email_connections"
        );
        Object.assign(error, { code: "42501" });
        throw error;
      }
      return {};
    });

    const firstResponsePromise = GET(request("connection-first"));
    await firstPaused;

    const secondResponse = await GET(request("connection-second"));
    expect(secondResponse.status).toBe(200);

    resumeFirst?.();
    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      featureEnabled: false,
    });
  });
});
