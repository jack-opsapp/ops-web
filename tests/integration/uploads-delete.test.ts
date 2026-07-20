import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const FOREIGN_COMPANY = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const FOREIGN_USER = "44444444-4444-4444-8444-444444444444";
const EXPENSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPLOAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPPORTUNITY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COMPANY_BUBBLE_ID = "1712345678901x123456789012345678";
const FOREIGN_COMPANY_BUBBLE_ID = "1712345678901x111111111111111111";
const PROJECT_BUBBLE_ID = "1712345678901x987654321098765432";
const OWN_KEY = `expenses/${COMPANY}/${USER}/${EXPENSE}/${UPLOAD}-full.jpg`;

type DbRow = Record<string, unknown>;
type PermissionScope = "all" | "assigned" | "own";

const verifyAuthTokenMock = vi.fn();
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: (token: string) => verifyAuthTokenMock(token),
}));

const rowsByTable = new Map<string, DbRow[]>();
const permissionScopes = new Map<string, PermissionScope>();
const opportunityEditAllowed = new Map<string, boolean>();
const storageRemoveMock = vi.fn();

function permissionKey(userId: string, permission: string): string {
  return `${userId}:${permission}`;
}

function setPermission(
  permission: string,
  scope: PermissionScope,
  userId = USER
) {
  permissionScopes.set(permissionKey(userId, permission), scope);
}

function setRows(table: string, rows: DbRow[]) {
  rowsByTable.set(table, rows);
}

class QueryStub {
  private filters: Array<(row: DbRow) => boolean> = [];
  private maxRows: number | null = null;

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  contains(column: string, values: unknown[]) {
    this.filters.push((row) => {
      const actual = row[column];
      return (
        Array.isArray(actual) && values.every((value) => actual.includes(value))
      );
    });
    return this;
  }

  or(clause: string) {
    const alternatives = [...clause.matchAll(/([a-z_]+)\.eq\.([^,]+)/gi)].map(
      ([, column, value]) => ({ column, value })
    );
    this.filters.push((row) =>
      alternatives.some(({ column, value }) => row[column] === value)
    );
    return this;
  }

  limit(count: number) {
    this.maxRows = count;
    return this;
  }

  async maybeSingle() {
    const rows = this.materialize();
    return { data: rows[0] ?? null, error: null };
  }

  private materialize(): DbRow[] {
    const filtered = (rowsByTable.get(this.table) ?? []).filter((row) =>
      this.filters.every((filter) => filter(row))
    );
    return this.maxRows === null ? filtered : filtered.slice(0, this.maxRows);
  }
}

function makeSupabaseStub() {
  return {
    from: (table: string) => new QueryStub(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "authorize_opportunity_action_as_system") {
        return {
          data:
            args.p_action === "edit" &&
            opportunityEditAllowed.get(String(args.p_opportunity_id)) === true,
          error: null,
        };
      }
      if (name === "has_permission") {
        const actual = permissionScopes.get(
          permissionKey(String(args.p_user_id), String(args.p_permission))
        );
        const required = (args.p_required_scope ?? "all") as PermissionScope;
        const rank: Record<PermissionScope, number> = {
          own: 1,
          assigned: 2,
          all: 3,
        };
        return {
          data: actual !== undefined && rank[actual] >= rank[required],
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    storage: {
      from: (bucket: string) => ({
        remove: (keys: string[]) => storageRemoveMock(bucket, keys),
      }),
    },
  };
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeSupabaseStub(),
}));

const rateLimitMock = vi.fn();
vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: (options: unknown) => rateLimitMock(options),
}));

const s3SendMock = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  DeleteObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

vi.mock("@/lib/s3/client", () => ({
  getS3Client: () => ({ send: (command: unknown) => s3SendMock(command) }),
  S3_BUCKET: "ops-app-files-prod",
  S3_REGION: "us-west-2",
}));

async function loadRoute() {
  return (await import("@/app/api/uploads/delete/route")).POST;
}

function request(url: string, token = "ok"): NextRequest {
  return new Request("http://localhost/api/uploads/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ url }),
  }) as unknown as NextRequest;
}

function s3Url(key: string): string {
  return `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/${key}`;
}

function activeUser(overrides: DbRow = {}): DbRow {
  return {
    id: USER,
    company_id: COMPANY,
    auth_id: "firebase-user",
    firebase_uid: null,
    is_active: true,
    deleted_at: null,
    is_company_admin: false,
    profile_image_url: null,
    ...overrides,
  };
}

beforeEach(() => {
  verifyAuthTokenMock.mockReset();
  verifyAuthTokenMock.mockResolvedValue({ uid: "firebase-user" });
  rowsByTable.clear();
  setRows("users", [activeUser()]);
  setRows("companies", [
    {
      id: COMPANY,
      bubble_id: COMPANY_BUBBLE_ID,
      account_holder_id: null,
      admin_ids: [],
      logo_url: null,
    },
  ]);
  setRows("expenses", []);
  setRows("opportunities", []);
  setRows("projects", []);
  setRows("project_photos", []);
  setRows("project_tasks", []);
  permissionScopes.clear();
  opportunityEditAllowed.clear();
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({
    exceeded: false,
    count: 1,
    retryAfterSec: 0,
  });
  s3SendMock.mockReset();
  s3SendMock.mockResolvedValue({});
  storageRemoveMock.mockReset();
  storageRemoveMock.mockResolvedValue({ error: null });
  vi.resetModules();
});

describe("POST /api/uploads/delete", () => {
  it("requires authentication", async () => {
    const POST = await loadRoute();
    expect((await POST(request(OWN_KEY, ""))).status).toBe(401);
  });

  it("rejects an inactive authenticated user", async () => {
    setRows("users", [activeUser({ is_active: false })]);
    const POST = await loadRoute();
    expect((await POST(request(OWN_KEY))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("deletes the authenticated user's deterministic S3 receipt key", async () => {
    const POST = await loadRoute();
    const res = await POST(request(s3Url(OWN_KEY)));

    expect(res.status).toBe(200);
    const command = s3SendMock.mock.calls[0][0] as {
      input: Record<string, unknown>;
    };
    expect(command.input).toEqual({
      Bucket: "ops-app-files-prod",
      Key: OWN_KEY,
    });
  });

  it("rejects a deterministic receipt owned by another company", async () => {
    const POST = await loadRoute();
    const key = `expenses/${FOREIGN_COMPANY}/${USER}/${EXPENSE}/${UPLOAD}-full.jpg`;
    expect((await POST(request(key))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("rejects a deterministic receipt owned by another user in the same company", async () => {
    const POST = await loadRoute();
    const key = `expenses/${COMPANY}/${FOREIGN_USER}/${EXPENSE}/${UPLOAD}-thumbnail.jpg`;
    expect((await POST(request(key))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("authorizes a legacy receipt against the expense submitter and edit scope", async () => {
    const legacyKey = `company-${COMPANY}/expenses/receipt_${EXPENSE}_1712345678.jpg`;
    setRows("expenses", [
      { id: EXPENSE, company_id: COMPANY, submitted_by: USER },
    ]);
    setPermission("expenses.edit", "own");

    const POST = await loadRoute();
    expect((await POST(request(legacyKey))).status).toBe(200);
  });

  it("denies another submitter's legacy receipt to an own-scope company member", async () => {
    const legacyKey = `company-${COMPANY}/expenses/receipt_${EXPENSE}_1712345678.jpg`;
    setRows("expenses", [
      { id: EXPENSE, company_id: COMPANY, submitted_by: FOREIGN_USER },
    ]);
    setPermission("expenses.edit", "own");

    const POST = await loadRoute();
    expect((await POST(request(legacyKey))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("denies a foreign-company receipt path even when its filename names an editable local expense", async () => {
    const key = `company-${FOREIGN_COMPANY}/expenses/receipt_${EXPENSE}_1712345678.jpg`;
    setRows("expenses", [
      { id: EXPENSE, company_id: COMPANY, submitted_by: USER },
    ]);
    setPermission("expenses.edit", "own");

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("authorizes the user whose profile row still references the object", async () => {
    const key = `profiles/${COMPANY}/1712345678-profile.jpg`;
    const url = s3Url(key);
    setRows("users", [activeUser({ profile_image_url: url })]);

    const POST = await loadRoute();
    expect((await POST(request(url))).status).toBe(200);
  });

  it("denies a same-company member deleting another user's profile object", async () => {
    const key = `profiles/${COMPANY}/1712345678-profile.jpg`;
    const url = s3Url(key);
    setRows("users", [
      activeUser(),
      activeUser({
        id: FOREIGN_USER,
        auth_id: "other-auth",
        profile_image_url: url,
      }),
    ]);

    const POST = await loadRoute();
    expect((await POST(request(url))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("authorizes a company admin deleting the company's prior logo", async () => {
    const key = `logos/${COMPANY}/1712345678-logo.jpg`;
    const url = s3Url(key);
    setRows("users", [activeUser({ is_company_admin: true })]);
    setRows("companies", [
      {
        id: COMPANY,
        bubble_id: COMPANY_BUBBLE_ID,
        account_holder_id: null,
        admin_ids: [],
        logo_url: url,
      },
    ]);

    const POST = await loadRoute();
    expect((await POST(request(url))).status).toBe(200);
  });

  it("denies a non-admin deleting the company's logo", async () => {
    const key = `logos/${COMPANY}/1712345678-logo.jpg`;
    const url = s3Url(key);
    setRows("companies", [
      {
        id: COMPANY,
        bubble_id: COMPANY_BUBBLE_ID,
        account_holder_id: null,
        admin_ids: [],
        logo_url: url,
      },
    ]);

    const POST = await loadRoute();
    expect((await POST(request(url))).status).toBe(403);
  });

  it("uses the canonical opportunity edit boundary for a lead photo", async () => {
    const key = `opportunities/${COMPANY}/${OPPORTUNITY}/1712345678-photo.jpg`;
    opportunityEditAllowed.set(OPPORTUNITY, true);

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(200);
  });

  it("denies a lead photo when the canonical opportunity edit boundary denies", async () => {
    const key = `opportunities/${COMPANY}/${OPPORTUNITY}/1712345678-photo.jpg`;
    opportunityEditAllowed.set(OPPORTUNITY, false);

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("recovers the opportunity id from a migrated email-import key", async () => {
    const key = `migrated/supabase-storage/images/email-imports/${OPPORTUNITY}/photo.jpg`;
    opportunityEditAllowed.set(OPPORTUNITY, true);

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(200);
  });

  it("rejects a migrated wrapper whose source bucket is unsupported", async () => {
    const key = `migrated/supabase-storage/private-files/email-imports/${OPPORTUNITY}/photo.jpg`;
    opportunityEditAllowed.set(OPPORTUNITY, true);

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("authorizes a project photo with all-project edit scope", async () => {
    const key = `projects/${COMPANY}/${PROJECT}/1712345678-photo.jpg`;
    setRows("projects", [
      {
        id: PROJECT,
        bubble_id: PROJECT_BUBBLE_ID,
        company_id: COMPANY,
        deleted_at: null,
      },
    ]);
    setPermission("projects.edit", "all");

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(200);
  });

  it("denies a project photo without project edit authority", async () => {
    const key = `projects/${COMPANY}/${PROJECT}/1712345678-photo.jpg`;
    setRows("projects", [
      {
        id: PROJECT,
        bubble_id: PROJECT_BUBBLE_ID,
        company_id: COMPANY,
        deleted_at: null,
      },
    ]);

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("maps old Bubble company/project paths before checking assigned project access", async () => {
    const key = `company-${COMPANY_BUBBLE_ID}/${PROJECT_BUBBLE_ID}/photos/1712345678.jpg`;
    setRows("projects", [
      {
        id: PROJECT,
        bubble_id: PROJECT_BUBBLE_ID,
        company_id: COMPANY,
        deleted_at: null,
      },
    ]);
    setRows("project_tasks", [
      {
        id: "task-1",
        project_id: PROJECT,
        deleted_at: null,
        team_member_ids: [USER],
      },
    ]);
    setPermission("projects.edit", "assigned");

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(200);
  });

  it("denies an old project-photo path whose Bubble company prefix is foreign", async () => {
    const key = `company-${FOREIGN_COMPANY_BUBBLE_ID}/${PROJECT_BUBBLE_ID}/photos/1712345678.jpg`;
    setRows("projects", [
      {
        id: PROJECT,
        bubble_id: PROJECT_BUBBLE_ID,
        company_id: COMPANY,
        deleted_at: null,
      },
    ]);
    setPermission("projects.edit", "all");

    const POST = await loadRoute();
    expect((await POST(request(key))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("removes an authorized project photo from its original Supabase bucket", async () => {
    const key = `${COMPANY}/${PROJECT}/photo.jpg`;
    const url = `https://project.supabase.co/storage/v1/object/public/project-photos/${key}`;
    setRows("projects", [
      {
        id: PROJECT,
        bubble_id: PROJECT_BUBBLE_ID,
        company_id: COMPANY,
        deleted_at: null,
      },
    ]);
    setPermission("projects.edit", "all");

    const POST = await loadRoute();
    expect((await POST(request(url))).status).toBe(200);
    expect(storageRemoveMock).toHaveBeenCalledWith("project-photos", [key]);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("falls back to the soft-deleted project-photo row for migrated demo paths", async () => {
    const key = `migrated/supabase-storage/project-photos/${COMPANY}/demo/photo.jpg`;
    const url = s3Url(key);
    setRows("projects", [
      {
        id: PROJECT,
        bubble_id: PROJECT_BUBBLE_ID,
        company_id: COMPANY,
        deleted_at: null,
      },
    ]);
    setRows("project_photos", [
      {
        project_id: PROJECT,
        company_id: COMPANY,
        url,
        thumbnail_url: null,
        rendered_url: null,
        deleted_at: "2026-07-19T00:00:00.000Z",
      },
    ]);
    setPermission("projects.edit", "all");

    const POST = await loadRoute();
    expect((await POST(request(url))).status).toBe(200);
  });

  it("removes an owned deterministic receipt from the Supabase images bucket", async () => {
    const url = `https://project.supabase.co/storage/v1/object/public/images/${OWN_KEY}`;
    const POST = await loadRoute();

    expect((await POST(request(url))).status).toBe(200);
    expect(storageRemoveMock).toHaveBeenCalledWith("images", [OWN_KEY]);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown same-company namespace instead of falling back to company membership", async () => {
    const POST = await loadRoute();
    const key = `training_data/${COMPANY}/private-sample.json`;
    expect((await POST(request(key))).status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the same deterministic S3 key is deleted twice", async () => {
    const POST = await loadRoute();
    expect((await POST(request(OWN_KEY))).status).toBe(200);
    expect((await POST(request(OWN_KEY))).status).toBe(200);
    expect(s3SendMock).toHaveBeenCalledTimes(2);
  });

  it("rejects URLs outside OPS-managed storage", async () => {
    const POST = await loadRoute();
    expect((await POST(request("https://example.com/file.jpg"))).status).toBe(
      400
    );
    expect(s3SendMock).not.toHaveBeenCalled();
  });
});
