import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkPermissionByIdMock } = vi.hoisted(() => ({
  checkPermissionByIdMock: vi.fn(),
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

import { authorizeEmailAnalysisJobContinuation } from "@/lib/email/email-analysis-job-access";

function database({
  job = {
    id: "job-1",
    company_id: "company-1",
    connection_id: "connection-1",
    requested_by_user_id: "user-1",
    connection_owner_user_id: "user-1",
  },
  connection = {
    id: "connection-1",
    company_id: "company-1",
    email: "owner@example.com",
    type: "individual",
    user_id: "user-1",
    status: "active",
    sync_enabled: true,
  },
  user = {
    id: "user-1",
    company_id: "company-1",
    is_active: true,
    deleted_at: null,
  },
}: {
  job?: Record<string, unknown> | null;
  connection?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
} = {}) {
  return {
    from(table: string) {
      let row =
        table === "gmail_scan_jobs"
          ? job
          : table === "users"
            ? user
            : connection;
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          if (row && row[column] !== value) row = null;
          return query;
        }),
        is: vi.fn((column: string, value: unknown) => {
          if (row && row[column] !== value) row = null;
          return query;
        }),
        maybeSingle: vi.fn(async () => ({ data: row, error: null })),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: row ? [row] : [], error: null }).then(
            resolve
          ),
      };
      return query;
    },
  } as never;
}

describe("email analysis job continuation access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermissionByIdMock.mockResolvedValue(false);
  });

  it("re-authorizes the immutable requester and matching personal owner", async () => {
    await expect(
      authorizeEmailAnalysisJobContinuation({
        supabase: database(),
        jobId: "job-1",
        claimedConnectionId: "connection-1",
        claimedCompanyId: "company-1",
      })
    ).resolves.toMatchObject({
      allowed: true,
      actorUserId: "user-1",
      connectionOwnerUserId: "user-1",
    });
  });

  it("fails closed after the personal mailbox owner changes", async () => {
    const result = await authorizeEmailAnalysisJobContinuation({
      supabase: database({
        connection: {
          id: "connection-1",
          company_id: "company-1",
          email: "new-owner@example.com",
          type: "individual",
          user_id: "user-2",
          status: "active",
          sync_enabled: true,
        },
      }),
      jobId: "job-1",
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: "connection_access_revoked",
    });
  });

  it("fails closed after the connection is disabled", async () => {
    const result = await authorizeEmailAnalysisJobContinuation({
      supabase: database({
        connection: {
          id: "connection-1",
          company_id: "company-1",
          email: "owner@example.com",
          type: "individual",
          user_id: "user-1",
          status: "active",
          sync_enabled: false,
        },
      }),
      jobId: "job-1",
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: "connection_access_revoked",
    });
  });

  it("rechecks all-scope integration permission for company mailboxes", async () => {
    const db = database({
      job: {
        id: "job-1",
        company_id: "company-1",
        connection_id: "connection-1",
        requested_by_user_id: "user-1",
        connection_owner_user_id: null,
      },
      connection: {
        id: "connection-1",
        company_id: "company-1",
        email: "shared@example.com",
        type: "company",
        user_id: null,
        status: "active",
        sync_enabled: true,
      },
    });

    expect(
      await authorizeEmailAnalysisJobContinuation({
        supabase: db,
        jobId: "job-1",
      })
    ).toMatchObject({ allowed: false, reason: "connection_access_revoked" });
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      "user-1",
      "settings.integrations",
      "all"
    );
  });

  it("ignores a legacy company connector user when comparing owner snapshots", async () => {
    checkPermissionByIdMock.mockResolvedValue(true);
    const result = await authorizeEmailAnalysisJobContinuation({
      supabase: database({
        job: {
          id: "job-1",
          company_id: "company-1",
          connection_id: "connection-1",
          requested_by_user_id: "user-1",
          connection_owner_user_id: null,
        },
        connection: {
          id: "connection-1",
          company_id: "company-1",
          email: "shared@example.com",
          type: "company",
          user_id: "legacy-connector-user",
          status: "active",
          sync_enabled: true,
        },
      }),
      jobId: "job-1",
    });

    expect(result).toMatchObject({
      allowed: true,
      actorUserId: "user-1",
      connectionOwnerUserId: null,
    });
  });

  it("rejects spoofed continuation identifiers", async () => {
    await expect(
      authorizeEmailAnalysisJobContinuation({
        supabase: database(),
        jobId: "job-1",
        claimedConnectionId: "connection-2",
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "job_identity_mismatch",
    });
  });
});
