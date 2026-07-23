import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "66666666-6666-4666-8666-666666666666";

interface ProjectRow {
  id: string;
  company_id: string;
  title: string;
  deleted_at: string | null;
}

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  canEditSharePhotoProject: vi.fn(),
  rateLimit: vi.fn(),
  serviceClient: null as unknown,
}));

const state = {
  projects: new Map<string, ProjectRow>(),
  notificationKeys: new Set<string>(),
  rpcCalls: [] as Array<Record<string, unknown>>,
  rpcError: null as null | { message: string },
};

function makeServiceClient() {
  return {
    from(table: string) {
      if (table !== "projects") {
        throw new Error(`Unexpected table: ${table}`);
      }
      const filters = new Map<string, unknown>();
      const builder = {
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return builder;
        },
        async maybeSingle() {
          const id = filters.get("id");
          return {
            data:
              typeof id === "string" ? (state.projects.get(id) ?? null) : null,
            error: null,
          };
        },
      };
      return { select: () => builder };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== "create_notification_if_new_with_status") {
        throw new Error(`Unexpected RPC: ${name}`);
      }
      state.rpcCalls.push(args);
      if (state.rpcError) return { data: null, error: state.rpcError };
      const key = args.p_dedupe_key as string;
      const created = !state.notificationKeys.has(key);
      state.notificationKeys.add(key);
      return { data: created, error: null };
    },
  };
}

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: mocks.verifyAuthToken,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: mocks.findUserByAuth,
}));

vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/uploads/share-photo-permission", () => ({
  canEditSharePhotoProject: mocks.canEditSharePhotoProject,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.serviceClient,
}));

import { POST } from "@/app/api/uploads/share-photo/recovery/route";

function request(
  projectId = PROJECT_ID,
  jobId = JOB_ID,
  token: string | null = "valid-token"
) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(
    `https://app.opsapp.co/api/uploads/share-photo/recovery?projectId=${encodeURIComponent(projectId)}&jobId=${encodeURIComponent(jobId)}`,
    { method: "POST", headers }
  );
}

describe("POST /api/uploads/share-photo/recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.projects.clear();
    state.notificationKeys.clear();
    state.rpcCalls.length = 0;
    state.rpcError = null;
    state.projects.set(PROJECT_ID, {
      id: PROJECT_ID,
      company_id: COMPANY_ID,
      title: "580 Beach Dr",
      deleted_at: null,
    });
    mocks.serviceClient = makeServiceClient();
    mocks.verifyAuthToken.mockResolvedValue({
      uid: "firebase-user",
      email: "operator@ops.test",
    });
    mocks.findUserByAuth.mockResolvedValue({
      id: USER_ID,
      company_id: COMPANY_ID,
      is_active: true,
    });
    mocks.rateLimit.mockResolvedValue({
      exceeded: false,
      count: 1,
      retryAfterSec: 0,
    });
    mocks.canEditSharePhotoProject.mockResolvedValue(true);
  });

  it("creates one standard linked recovery notice for an active owned project", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(state.rpcCalls).toEqual([
      expect.objectContaining({
        p_user_id: USER_ID,
        p_company_id: COMPANY_ID,
        p_type: "system",
        p_title: "Photo upload needs attention",
        p_body: "Open 580 Beach Dr and share the photo again.",
        p_persistent: false,
        p_action_url: `/dashboard?openProject=${PROJECT_ID}&mode=view`,
        p_action_label: "VIEW PROJECT",
        p_project_id: PROJECT_ID,
        p_deep_link_type: "projectNotes",
        p_dedupe_key: `share-photo:recovery:${JOB_ID}`,
      }),
    ]);
  });

  it("uses a stable opaque dedupe key for bounded legacy identifiers", async () => {
    const legacyProject = "corrupt-project";
    const legacyJob = "legacy-job-17";
    const expectedHash = createHash("sha256")
      .update(`${USER_ID}\0${legacyJob}`)
      .digest("hex");

    const first = await POST(request(legacyProject, legacyJob));
    const second = await POST(request(legacyProject, legacyJob));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.notificationKeys.size).toBe(1);
    expect(state.rpcCalls).toHaveLength(2);
    expect(state.rpcCalls[0]).toEqual(
      expect.objectContaining({
        p_body:
          "A shared photo could not be attached. Share it again to an active project.",
        p_persistent: false,
        p_action_url: undefined,
        p_action_label: undefined,
        p_project_id: undefined,
        p_deep_link_type: undefined,
        p_dedupe_key: `share-photo:recovery:${expectedHash}`,
      })
    );
  });

  it("rejects a valid project owned by another company", async () => {
    state.projects.get(PROJECT_ID)!.company_id = FOREIGN_COMPANY_ID;

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("uses an unlinked notice when current project edit access was revoked", async () => {
    mocks.canEditSharePhotoProject.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(state.rpcCalls).toEqual([
      expect.objectContaining({
        p_body:
          "A shared photo could not be attached. Share it again to an active project.",
        p_action_url: undefined,
        p_action_label: undefined,
        p_project_id: undefined,
        p_deep_link_type: undefined,
      }),
    ]);
  });

  it.each([
    ["", JOB_ID],
    ["project", ""],
    ["project", "x".repeat(129)],
    ["project", "legacy\u0000job"],
  ])("rejects unsafe recovery identifiers", async (projectId, jobId) => {
    const response = await POST(request(projectId, jobId));

    expect(response.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("returns failure when the notice was not durably acknowledged", async () => {
    state.rpcError = { message: "notification unavailable" };

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to record recovery notice",
    });
  });

  it("requires an authenticated operator", async () => {
    const response = await POST(request(PROJECT_ID, JOB_ID, null));

    expect(response.status).toBe(401);
    expect(state.rpcCalls).toHaveLength(0);
  });
});
