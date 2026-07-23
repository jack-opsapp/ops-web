import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const JOB_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_JOB_ID = "77777777-7777-4777-8777-777777777777";

interface ProjectRow {
  id: string;
  company_id: string;
  title: string;
  project_images: string[];
  deleted_at: string | null;
}

interface PhotoRow {
  id: string;
  project_id: string;
  company_id: string;
  url: string;
  source: string;
  uploaded_by: string;
  is_client_visible: boolean;
  taken_at: string;
  deleted_at: string | null;
}

interface NotificationRow {
  user_id: string;
  company_id: string;
  type: string;
  dedupe_key: string;
  project_id?: string;
}

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  findUserByAuth: vi.fn(),
  resolvePermissionScopeById: vi.fn(),
  rateLimit: vi.fn(),
  s3Send: vi.fn(),
  serviceClient: null as unknown,
}));

const state = {
  projects: new Map<string, ProjectRow>(),
  photos: new Map<string, PhotoRow>(),
  notifications: [] as NotificationRow[],
  filingRpcCalls: [] as Array<Record<string, unknown>>,
  notificationRpcCalls: [] as Array<Record<string, unknown>>,
  assignedProjects: new Set<string>(),
  filingRpcError: null as null | { code: string; message: string },
  notificationRpcError: null as null | { message: string },
};

function photoUrl(projectId: string, jobId = JOB_ID, companyId = COMPANY_ID) {
  return `https://cdn.ops.test/projects/${companyId}/${projectId}/share-${jobId}.jpg`;
}

function makeSelectBuilder<T>(
  resolve: (filters: Map<string, unknown>) => T | null
) {
  const filters = new Map<string, unknown>();
  const builder = {
    eq(column: string, value: unknown) {
      filters.set(column, value);
      return builder;
    },
    is(column: string, value: unknown) {
      filters.set(column, value);
      return builder;
    },
    async maybeSingle() {
      return { data: resolve(filters), error: null };
    },
  };
  return builder;
}

function makeServiceClient() {
  return {
    from(table: string) {
      if (table === "projects") {
        return {
          select: () =>
            makeSelectBuilder((filters) => {
              const id = filters.get("id");
              return typeof id === "string"
                ? (state.projects.get(id) ?? null)
                : null;
            }),
        };
      }

      if (table === "project_photos") {
        return {
          select: () =>
            makeSelectBuilder((filters) => {
              const id = filters.get("id");
              return typeof id === "string"
                ? (state.photos.get(id) ?? null)
                : null;
            }),
        };
      }

      if (table === "project_tasks") {
        const filters = new Map<string, unknown>();
        const builder = {
          eq(column: string, value: unknown) {
            filters.set(column, value);
            return builder;
          },
          is(column: string, value: unknown) {
            filters.set(column, value);
            return builder;
          },
          contains() {
            return builder;
          },
          limit() {
            return builder;
          },
          async maybeSingle() {
            const projectId = filters.get("project_id");
            return {
              data:
                typeof projectId === "string" &&
                state.assignedProjects.has(projectId)
                  ? { id: "assigned-task" }
                  : null,
              error: null,
            };
          },
        };
        return { select: () => builder };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "file_share_photo_as_system") {
        state.filingRpcCalls.push(args);
        if (state.filingRpcError) {
          return { data: null, error: state.filingRpcError };
        }
        const id = args.p_job_id as string;
        const existing = state.photos.get(id);
        if (
          existing &&
          (existing.project_id !== args.p_project_id ||
            existing.company_id !== args.p_company_id ||
            existing.url !== args.p_url ||
            existing.uploaded_by !== args.p_actor_user_id ||
            Date.parse(existing.taken_at) !==
              Date.parse(args.p_taken_at as string))
        ) {
          return {
            data: null,
            error: {
              code: "23505",
              message: "share_photo_identity_conflict",
            },
          };
        }

        const project = state.projects.get(args.p_project_id as string);
        if (!project || project.deleted_at) {
          return {
            data: null,
            error: { code: "P0002", message: "share_photo_project_not_found" },
          };
        }

        if (!existing) {
          state.photos.set(id, {
            id,
            project_id: args.p_project_id as string,
            company_id: args.p_company_id as string,
            url: args.p_url as string,
            source: "in_progress",
            uploaded_by: args.p_actor_user_id as string,
            is_client_visible: false,
            taken_at: args.p_taken_at as string,
            deleted_at: null,
          });
        }
        if (
          !existing?.deleted_at &&
          !project.project_images.includes(args.p_url as string)
        ) {
          project.project_images.push(args.p_url as string);
        }
        return {
          data: [
            {
              photo_id: id,
              created: !existing,
              attached: !existing?.deleted_at,
            },
          ],
          error: null,
        };
      }

      if (name === "create_notification_if_new_with_status") {
        state.notificationRpcCalls.push(args);
        if (state.notificationRpcError) {
          return { data: null, error: state.notificationRpcError };
        }
        const duplicate = state.notifications.some(
          (row) =>
            row.user_id === args.p_user_id &&
            row.company_id === args.p_company_id &&
            row.type === args.p_type &&
            row.dedupe_key === args.p_dedupe_key
        );
        if (!duplicate) {
          state.notifications.push({
            user_id: args.p_user_id as string,
            company_id: args.p_company_id as string,
            type: args.p_type as string,
            project_id: args.p_project_id as string,
            dedupe_key: args.p_dedupe_key as string,
          });
        }
        return { data: !duplicate, error: null };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
}

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: mocks.verifyAuthToken,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: mocks.findUserByAuth,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  resolvePermissionScopeById: mocks.resolvePermissionScopeById,
}));

vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.serviceClient,
}));

vi.mock("@/lib/s3/path-auth", () => ({
  authorizeFolder: (folder: string) => ({ ok: true, folder }),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: class {
    readonly kind = "put";
    constructor(readonly input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    readonly kind = "delete";
    constructor(readonly input: Record<string, unknown>) {}
  },
}));

vi.mock("@/lib/s3/client", () => ({
  getS3Client: () => ({ send: mocks.s3Send }),
  S3_BUCKET: "test-bucket",
  buildPublicS3Url: (key: string) => `https://cdn.ops.test/${key}`,
  getStorageBackend: () => "s3",
}));

import { POST } from "@/app/api/uploads/share-photo/route";

function request(
  projectId = PROJECT_ID,
  jobId = JOB_ID,
  token: string | null = "valid-token",
  takenAt = "2026-07-23T16%3A30%3A00.000Z",
  contentType = "image/jpeg"
) {
  const headers: Record<string, string> = {
    "content-type": contentType,
  };
  if (token) headers.authorization = `Bearer ${token}`;

  return new NextRequest(
    `https://app.opsapp.co/api/uploads/share-photo?projectId=${projectId}&jobId=${jobId}&takenAt=${takenAt}`,
    {
      method: "POST",
      headers,
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    }
  );
}

describe("POST /api/uploads/share-photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.projects.clear();
    state.photos.clear();
    state.notifications.length = 0;
    state.filingRpcCalls.length = 0;
    state.notificationRpcCalls.length = 0;
    state.assignedProjects.clear();
    state.filingRpcError = null;
    state.notificationRpcError = null;
    state.projects.set(PROJECT_ID, {
      id: PROJECT_ID,
      company_id: COMPANY_ID,
      title: "580 Beach Dr",
      project_images: [],
      deleted_at: null,
    });
    state.projects.set(OTHER_PROJECT_ID, {
      id: OTHER_PROJECT_ID,
      company_id: COMPANY_ID,
      title: "Other project",
      project_images: [],
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
    mocks.resolvePermissionScopeById.mockResolvedValue("all");
    mocks.rateLimit.mockResolvedValue({
      exceeded: false,
      count: 1,
      retryAfterSec: 0,
    });
    mocks.s3Send.mockResolvedValue({});
  });

  it("atomically collapses concurrent retries to one photo row and one notification", async () => {
    const [first, second] = await Promise.all([
      POST(request()),
      POST(request()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect([...state.photos.values()]).toEqual([
      expect.objectContaining({
        id: JOB_ID,
        project_id: PROJECT_ID,
        company_id: COMPANY_ID,
        url: photoUrl(PROJECT_ID),
      }),
    ]);
    expect(state.projects.get(PROJECT_ID)?.project_images).toEqual([
      photoUrl(PROJECT_ID),
    ]);
    expect(state.notifications).toEqual([
      expect.objectContaining({
        user_id: USER_ID,
        company_id: COMPANY_ID,
        project_id: PROJECT_ID,
        type: "photo_uploaded",
        dedupe_key: `share-photo:project:${PROJECT_ID}:burst:1983138`,
      }),
    ]);
    expect(mocks.findUserByAuth).toHaveBeenCalledWith(
      "firebase-user",
      undefined,
      "id, company_id, is_active"
    );
  });

  it("serializes different jobs so neither project image is lost", async () => {
    const [first, second] = await Promise.all([
      POST(request(PROJECT_ID, JOB_ID)),
      POST(request(PROJECT_ID, SECOND_JOB_ID)),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.photos.size).toBe(2);
    expect(state.projects.get(PROJECT_ID)?.project_images).toEqual([
      photoUrl(PROJECT_ID, JOB_ID),
      photoUrl(PROJECT_ID, SECOND_JOB_ID),
    ]);
  });

  it("allows an assigned-scope editor only on an assigned project", async () => {
    mocks.resolvePermissionScopeById.mockResolvedValue("assigned");
    state.assignedProjects.add(PROJECT_ID);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(state.photos.size).toBe(1);
  });

  it("rejects an assigned-scope editor from an unassigned project", async () => {
    mocks.resolvePermissionScopeById.mockResolvedValue("assigned");

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("repairs an idempotent database retry without uploading the bytes again", async () => {
    state.photos.set(JOB_ID, {
      id: JOB_ID,
      project_id: PROJECT_ID,
      company_id: COMPANY_ID,
      url: photoUrl(PROJECT_ID),
      source: "in_progress",
      uploaded_by: USER_ID,
      is_client_visible: false,
      taken_at: "2026-07-23T16:30:00.000Z",
      deleted_at: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.s3Send).not.toHaveBeenCalled();
    expect(state.projects.get(PROJECT_ID)?.project_images).toEqual([
      photoUrl(PROJECT_ID),
    ]);
  });

  it.each([
    ["project", { project_id: OTHER_PROJECT_ID }],
    ["company", { company_id: FOREIGN_COMPANY_ID }],
    ["URL", { url: "https://cdn.ops.test/wrong-object.jpg" }],
    ["uploader", { uploaded_by: OTHER_USER_ID }],
    ["timestamp", { taken_at: "2026-07-23T16:31:00.000Z" }],
  ])(
    "rejects reuse of a job identity bound to a different %s",
    async (_label, overrides) => {
      state.photos.set(JOB_ID, {
        id: JOB_ID,
        project_id: PROJECT_ID,
        company_id: COMPANY_ID,
        url: photoUrl(PROJECT_ID),
        source: "in_progress",
        uploaded_by: USER_ID,
        is_client_visible: false,
        taken_at: "2026-07-23T16:30:00.000Z",
        deleted_at: null,
        ...overrides,
      });

      const response = await POST(request());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "jobId is already bound to a different photo",
      });
      expect(mocks.s3Send).not.toHaveBeenCalled();
      expect(state.notifications).toHaveLength(0);
    }
  );

  it("requires the idempotency key to be a UUID", async () => {
    const response = await POST(request(PROJECT_ID, "not-a-uuid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid jobId",
    });
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("requires a stable capture timestamp", async () => {
    const response = await POST(request(PROJECT_ID, JOB_ID, "valid-token", ""));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid takenAt",
    });
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("accepts only the JPEG bytes used by the iOS contract", async () => {
    const response = await POST(
      request(
        PROJECT_ID,
        JOB_ID,
        "valid-token",
        "2026-07-23T16%3A30%3A00.000Z",
        "image/png"
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("does not resurrect or announce a previously deleted job", async () => {
    state.photos.set(JOB_ID, {
      id: JOB_ID,
      project_id: PROJECT_ID,
      company_id: COMPANY_ID,
      url: photoUrl(PROJECT_ID),
      source: "in_progress",
      uploaded_by: USER_ID,
      is_client_visible: false,
      taken_at: "2026-07-23T16:30:00.000Z",
      deleted_at: "2026-07-23T17:30:00.000Z",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(state.projects.get(PROJECT_ID)?.project_images).toEqual([]);
    expect(state.notifications).toHaveLength(0);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("cleans a newly stored object after a permanent authorization race", async () => {
    state.filingRpcError = {
      code: "42501",
      message: "share_photo_forbidden",
    };

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.s3Send).toHaveBeenCalledTimes(2);
    expect(mocks.s3Send.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ kind: "put" })
    );
    expect(mocks.s3Send.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ kind: "delete" })
    );
  });

  it("retains the durable job until the completion notice is acknowledged", async () => {
    state.notificationRpcError = { message: "notification unavailable" };

    const first = await POST(request());

    expect(first.status).toBe(503);
    expect(state.photos.size).toBe(1);
    expect(state.projects.get(PROJECT_ID)?.project_images).toEqual([
      photoUrl(PROJECT_ID),
    ]);
    expect(mocks.s3Send).toHaveBeenCalledTimes(1);

    state.notificationRpcError = null;
    const retry = await POST(request());

    expect(retry.status).toBe(200);
    expect(state.notifications).toHaveLength(1);
    expect(mocks.s3Send).toHaveBeenCalledTimes(1);
  });

  it("rejects a project from another company before storing bytes", async () => {
    state.projects.get(PROJECT_ID)!.company_id = FOREIGN_COMPANY_ID;

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("requires an authenticated operator", async () => {
    const response = await POST(request(PROJECT_ID, JOB_ID, null));

    expect(response.status).toBe(401);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("rejects an inactive cryptographically linked user", async () => {
    mocks.findUserByAuth.mockResolvedValue({
      id: USER_ID,
      company_id: COMPANY_ID,
      is_active: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });
});
