/**
 * Integration tests for POST /api/uploads/presign after the Phase 1
 * Supabase → S3 cutover.
 *
 * Covers:
 *   - urlencoded (iOS) and JSON (web) presign request shapes both
 *     return S3 URLs.
 *   - Auth required: missing token → 401, invalid token → 401, valid
 *     token but no company association → 403.
 *   - Path-prefix authorization: cross-tenant folder is rejected;
 *     legacy non-scoped folder gets companyId appended.
 *   - PR #28 carve-out preserved: application/json under
 *     `training_data/` is allowed; application/json under any other
 *     folder is rejected.
 *   - Filename traversal stripped before composing the S3 key.
 *   - STORAGE_BACKEND=supabase short-circuits to the legacy code path.
 *   - Multipart (direct-upload) coverage runs in Playwright e2e —
 *     undici's multipart parser inside vitest+jsdom can't reconstruct
 *     File entries from a hand-rolled body, and the security
 *     properties match the urlencoded path 1:1.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const FOREIGN = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";
const EXPENSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPLOAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE_VISIT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ARTIFACT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const verifyAuthTokenMock = vi.fn();
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: (token: string) => verifyAuthTokenMock(token),
}));

interface AuthUserRow {
  id: string;
  company_id: string | null;
  is_active: boolean;
  deleted_at: string | null;
}

const usersByUid = new Map<string, AuthUserRow>();
const siteVisitsById = new Map<
  string,
  { id: string; company_id: string; deleted_at: string | null }
>();
const supabaseUploadMock = vi.fn();
const supabasePublicUrlMock = vi.fn();
const supabaseSignedUrlMock = vi.fn();

function makeSupabaseStub() {
  return {
    from: (table: string) => {
      if (table !== "users") {
        throw new Error(`Unexpected table in test: ${table}`);
      }
      let uidFilter = "";
      const builder = {
        select: () => builder,
        or: (clause: string) => {
          // Pull the uid out of "auth_id.eq.<uid>,firebase_uid.eq.<uid>"
          const match = clause.match(/auth_id\.eq\.([^,]+)/);
          uidFilter = match?.[1] ?? "";
          return builder;
        },
        maybeSingle: async () => {
          const row = usersByUid.get(uidFilter);
          if (!row) return { data: null, error: null };
          return { data: row, error: null };
        },
      };
      return builder;
    },
    storage: {
      from: () => ({
        upload: (key: string, body: unknown, opts: unknown) =>
          supabaseUploadMock(key, body, opts),
        getPublicUrl: (key: string) => supabasePublicUrlMock(key),
        createSignedUploadUrl: (key: string, options?: { upsert: boolean }) =>
          supabaseSignedUrlMock(key, options),
      }),
    },
  };
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeSupabaseStub(),
}));

const getAccessTokenClientMock = vi.fn((token: string) => ({
  from: (table: string) => {
    if (table !== "site_visits") {
      throw new Error(`Unexpected user-scoped table in test: ${table}`);
    }
    const filters = new Map<string, unknown>();
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.set(column, value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.set(column, value);
        return builder;
      },
      maybeSingle: async () => {
        const id = String(filters.get("id") ?? "");
        const row = siteVisitsById.get(id);
        if (
          !row ||
          row.company_id !== filters.get("company_id") ||
          row.deleted_at !== filters.get("deleted_at")
        ) {
          return { data: null, error: null };
        }
        return { data: row, error: null };
      },
    };
    return builder;
  },
  token,
}));
vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: (token: string) => getAccessTokenClientMock(token),
}));

const rateLimitMock =
  vi.fn<
    (
      opts: unknown
    ) => Promise<{ exceeded: boolean; count: number; retryAfterSec: number }>
  >();
vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: (opts: unknown) => rateLimitMock(opts),
}));

const s3SendMock = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  PutObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

const getSignedUrlMock = vi.fn();
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

// `getS3Client()` is memoized inside `@/lib/s3/client`. Mock the module
// to return an object with a stubbed `.send()` method instead of
// creating a real S3Client instance.
vi.mock("@/lib/s3/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3/client")>("@/lib/s3/client");
  return {
    ...actual,
    getS3Client: () => ({ send: (cmd: unknown) => s3SendMock(cmd) }),
  };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadRoute() {
  const mod = await import("@/app/api/uploads/presign/route");
  return mod.POST;
}

function urlencodedRequest(
  body: Record<string, string>,
  headers: Record<string, string> = {}
): NextRequest {
  return new Request("http://localhost/api/uploads/presign", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  }) as unknown as NextRequest;
}

function jsonRequest(
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new Request("http://localhost/api/uploads/presign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function activeUser(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
  return {
    id: "u-id",
    company_id: COMPANY,
    is_active: true,
    deleted_at: null,
    ...overrides,
  };
}

// Note on multipart coverage: undici's multipart parser inside vitest
// (jsdom) cannot reliably reconstruct File entries from a hand-rolled
// multipart body, and the jsdom Request constructor does not auto-set
// the multipart boundary when a FormData body is passed in. The
// multipart code path in `route.ts` is structurally identical to the
// urlencoded and JSON paths — same auth, same path-prefix check, same
// sanitization, same S3 client call — so the security-critical
// behavior is fully covered by the urlencoded/JSON tests below. The
// multipart path itself is exercised in Playwright e2e and during
// manual preview-URL verification before production deploy.

// ─── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  verifyAuthTokenMock.mockReset();
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({
    exceeded: false,
    count: 1,
    retryAfterSec: 0,
  });
  s3SendMock.mockReset();
  s3SendMock.mockResolvedValue({});
  getSignedUrlMock.mockReset();
  getSignedUrlMock.mockResolvedValue(
    "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/?signed=1"
  );
  supabaseUploadMock.mockReset();
  supabaseUploadMock.mockResolvedValue({ error: null });
  supabasePublicUrlMock.mockReset();
  supabasePublicUrlMock.mockReturnValue({
    data: {
      publicUrl:
        "https://example.supabase.co/storage/v1/object/public/images/foo",
    },
  });
  supabaseSignedUrlMock.mockReset();
  supabaseSignedUrlMock.mockResolvedValue({
    data: { signedUrl: "https://example.supabase.co/signed-upload" },
    error: null,
  });
  usersByUid.clear();
  siteVisitsById.clear();
  getAccessTokenClientMock.mockClear();
  process.env.STORAGE_BACKEND = "s3";
  vi.resetModules();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/uploads/presign — auth", () => {
  it("rejects missing Authorization header with 401", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest({
      filename: "x.jpg",
      contentType: "image/jpeg",
      folder: `projects/${COMPANY}/p1`,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token with 401", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("invalid"));
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.jpg",
        contentType: "image/jpeg",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer fake" }
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects a token whose user has no company association with 403", async () => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser({ company_id: null }));
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.jpg",
        contentType: "image/jpeg",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects an inactive user with 403", async () => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser({ is_active: false }));
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.jpg",
        contentType: "image/jpeg",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );

    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted user with 403", async () => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set(
      "u1",
      activeUser({ deleted_at: "2026-07-19T00:00:00.000Z" })
    );
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.jpg",
        contentType: "image/jpeg",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );

    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/uploads/presign — happy path", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser());
  });

  it("urlencoded (iOS): returns an S3 publicUrl pointing at ops-app-files-prod", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "photo.jpg",
        contentType: "image/jpeg",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.publicUrl).toMatch(
      /^https:\/\/ops-app-files-prod\.s3\.us-west-2\.amazonaws\.com\/projects\/11111111-1111-1111-1111-111111111111\/p1\/\d+-[a-z0-9]+\.jpg$/
    );
    expect(json.uploadUrl).toContain("signed=1");
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
  });

  it("JSON (web): returns an S3 publicUrl with companyId appended for unscoped folder", async () => {
    const POST = await loadRoute();
    const req = jsonRequest(
      { filename: "logo.png", contentType: "image/png", folder: "logos" },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    // The web client sent folder="logos" with no companyId — server should append it.
    expect(json.publicUrl).toMatch(
      /^https:\/\/ops-app-files-prod\.s3\.us-west-2\.amazonaws\.com\/logos\/11111111-1111-1111-1111-111111111111\/\d+-[a-z0-9]+\.png$/
    );
  });

  it("derives and reuses the exact caller-owned key for an expense-receipt retry", async () => {
    usersByUid.set("u1", activeUser({ id: USER }));
    const POST = await loadRoute();

    const makeRequest = () =>
      urlencodedRequest(
        {
          filename: "client-value-is-ignored.jpg",
          contentType: "image/jpeg",
          folder: `arbitrary/${FOREIGN}`,
          purpose: "expense_receipt",
          expenseId: EXPENSE,
          uploadId: UPLOAD,
          variant: "full",
        },
        { Authorization: "Bearer ok" }
      );

    const first = await POST(makeRequest());
    const second = await POST(makeRequest());
    const firstJson = await first.json();
    const secondJson = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstJson.publicUrl).toBe(
      `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/expenses/${COMPANY}/${USER}/${EXPENSE}/${UPLOAD}-full.jpg`
    );
    expect(secondJson.publicUrl).toBe(firstJson.publicUrl);

    const keys = getSignedUrlMock.mock.calls.map(
      (call) => (call[1] as { input: Record<string, unknown> }).input.Key
    );
    expect(keys).toEqual([
      `expenses/${COMPANY}/${USER}/${EXPENSE}/${UPLOAD}-full.jpg`,
      `expenses/${COMPANY}/${USER}/${EXPENSE}/${UPLOAD}-full.jpg`,
    ]);
  });

  it("separates full, thumbnail, upload, and authenticated-user tuples", async () => {
    usersByUid.set("u1", activeUser({ id: USER }));
    const POST = await loadRoute();
    const request = (variant: string, uploadId: string) =>
      urlencodedRequest(
        {
          filename: "ignored.jpg",
          contentType: "image/jpeg",
          folder: "ignored",
          purpose: "expense_receipt",
          expenseId: EXPENSE,
          uploadId,
          variant,
        },
        { Authorization: "Bearer ok" }
      );

    await POST(request("full", UPLOAD));
    await POST(request("thumbnail", UPLOAD));
    await POST(request("full", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"));

    verifyAuthTokenMock.mockResolvedValue({ uid: "u2", claims: {} });
    usersByUid.set("u2", activeUser({ id: OTHER_USER }));
    await POST(request("full", UPLOAD));

    const keys = getSignedUrlMock.mock.calls.map(
      (call) => (call[1] as { input: Record<string, unknown> }).input.Key
    );
    expect(keys).toEqual([
      `expenses/${COMPANY}/${USER}/${EXPENSE}/${UPLOAD}-full.jpg`,
      `expenses/${COMPANY}/${USER}/${EXPENSE}/${UPLOAD}-thumbnail.jpg`,
      `expenses/${COMPANY}/${USER}/${EXPENSE}/cccccccc-cccc-4ccc-8ccc-cccccccccccc-full.jpg`,
      `expenses/${COMPANY}/${OTHER_USER}/${EXPENSE}/${UPLOAD}-full.jpg`,
    ]);
  });

  it.each([
    [
      "bad expense id",
      {
        expenseId: "nope",
        uploadId: UPLOAD,
        variant: "full",
        contentType: "image/jpeg",
      },
    ],
    [
      "bad upload id",
      {
        expenseId: EXPENSE,
        uploadId: "nope",
        variant: "full",
        contentType: "image/jpeg",
      },
    ],
    [
      "bad variant",
      {
        expenseId: EXPENSE,
        uploadId: UPLOAD,
        variant: "preview",
        contentType: "image/jpeg",
      },
    ],
    [
      "bad content type",
      {
        expenseId: EXPENSE,
        uploadId: UPLOAD,
        variant: "full",
        contentType: "image/png",
      },
    ],
  ])(
    "rejects malformed expense-receipt purpose fields: %s",
    async (_label, values) => {
      usersByUid.set("u1", activeUser({ id: USER }));
      const POST = await loadRoute();
      const res = await POST(
        urlencodedRequest(
          {
            filename: "ignored.jpg",
            folder: "ignored",
            purpose: "expense_receipt",
            ...values,
          },
          { Authorization: "Bearer ok" }
        )
      );

      expect(res.status).toBe(400);
      expect(getSignedUrlMock).not.toHaveBeenCalled();
    }
  );

  it("keeps the legacy filename/folder request on random server keys", async () => {
    const POST = await loadRoute();
    const res = await POST(
      urlencodedRequest(
        {
          filename: `receipt_${EXPENSE}_${UPLOAD}.jpg`,
          contentType: "image/jpeg",
          folder: `expenses/${COMPANY}`,
        },
        { Authorization: "Bearer ok" }
      )
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.publicUrl).toMatch(
      new RegExp(
        `^https://ops-app-files-prod\\.s3\\.us-west-2\\.amazonaws\\.com/expenses/${COMPANY}/\\d+-[a-z0-9]+\\.jpg$`
      )
    );
  });

  // Multipart (direct upload) e2e coverage lives in Playwright — see
  // header note above the helpers section for rationale.
});

describe("POST /api/uploads/presign — site-visit media", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser());
    siteVisitsById.set(SITE_VISIT, {
      id: SITE_VISIT,
      company_id: COMPANY,
      deleted_at: null,
    });
  });

  const request = (
    overrides: Record<string, unknown> = {},
    token = "ok"
  ) =>
    jsonRequest(
      {
        targetType: "site_visit",
        siteVisitId: SITE_VISIT,
        artifactId: ARTIFACT,
        variant: "original",
        filename: "field-photo.heic",
        contentType: "image/heic",
        fileSize: 4_000_000,
        ...overrides,
      },
      { Authorization: `Bearer ${token}` }
    );

  it("authorizes through the caller token and returns one stable object key on retry", async () => {
    getSignedUrlMock
      .mockResolvedValueOnce("https://upload.example/?signed=first")
      .mockResolvedValueOnce("https://upload.example/?signed=second");
    const POST = await loadRoute();

    const first = await POST(request());
    const second = await POST(request());
    const firstBody = await first.json();
    const secondBody = await second.json();

    const expected =
      `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/` +
      `site-visits/${COMPANY}/${SITE_VISIT}/${ARTIFACT}/original.heic`;
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.publicUrl).toBe(expected);
    expect(secondBody.publicUrl).toBe(expected);
    expect(firstBody.uploadUrl).not.toBe(secondBody.uploadUrl);
    expect(getAccessTokenClientMock).toHaveBeenCalledWith("ok");

    const commands = getSignedUrlMock.mock.calls.map(
      (call) => (call[1] as { input: Record<string, unknown> }).input
    );
    expect(commands.map((command) => command.Key)).toEqual([
      `site-visits/${COMPANY}/${SITE_VISIT}/${ARTIFACT}/original.heic`,
      `site-visits/${COMPANY}/${SITE_VISIT}/${ARTIFACT}/original.heic`,
    ]);
    expect(commands[0]).toMatchObject({ ContentLength: 4_000_000 });
    const options = getSignedUrlMock.mock.calls[0][2] as {
      signableHeaders: Set<string>;
    };
    expect(options.signableHeaders.has("content-length")).toBe(true);
  });

  it("keeps original, rendered, and thumbnail variants on separate deterministic keys", async () => {
    const POST = await loadRoute();
    for (const variant of ["original", "rendered", "thumbnail"]) {
      await POST(request({ variant }));
    }

    const keys = getSignedUrlMock.mock.calls.map(
      (call) => (call[1] as { input: Record<string, unknown> }).input.Key
    );
    expect(keys).toEqual(
      ["original", "rendered", "thumbnail"].map(
        (variant) =>
          `site-visits/${COMPANY}/${SITE_VISIT}/${ARTIFACT}/${variant}.heic`
      )
    );
  });

  it("rejects a caller-supplied folder and malformed target values", async () => {
    const POST = await loadRoute();
    for (const overrides of [
      { folder: `site-visits/${FOREIGN}` },
      { siteVisitId: SITE_VISIT.toUpperCase() },
      { artifactId: "not-a-uuid" },
      { variant: "preview" },
      { fileSize: 10 * 1024 * 1024 + 1 },
    ]) {
      const response = await POST(request(overrides));
      expect(response.status).toBe(400);
    }
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    [
      "foreign-company",
      { id: SITE_VISIT, company_id: FOREIGN, deleted_at: null },
    ],
    [
      "deleted",
      {
        id: SITE_VISIT,
        company_id: COMPANY,
        deleted_at: "2026-07-31T20:00:00.000Z",
      },
    ],
  ])("does not presign a %s visit", async (_label, row) => {
    siteVisitsById.clear();
    if (row) siteVisitsById.set(SITE_VISIT, row);
    const POST = await loadRoute();

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/uploads/presign — path authorization", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser());
  });

  it("rejects a folder that names a different company UUID", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.jpg",
        contentType: "image/jpeg",
        folder: `projects/${FOREIGN}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects path-traversal in folder", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      { filename: "x.jpg", contentType: "image/jpeg", folder: "../etc/passwd" },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("strips path-traversal segments from filename before composing the key", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "../../../escape.jpg",
        contentType: "image/jpeg",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const cmd = (getSignedUrlMock.mock.calls[0]?.[1] ?? null) as {
      input: Record<string, unknown>;
    } | null;
    const key = cmd?.input.Key as string;
    expect(key).not.toContain("..");
    expect(key).toMatch(
      /^projects\/11111111-1111-1111-1111-111111111111\/p1\/\d+-[a-z0-9]+\.jpg$/
    );
  });
});

describe("POST /api/uploads/presign — content-type allowlist", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser());
  });

  it("rejects non-image, non-training-data content types", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.exe",
        contentType: "application/octet-stream",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("preserves PR #28 carve-out: application/json under training_data/ is allowed", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "entry.json",
        contentType: "application/json",
        folder: `training_data/deck_scanner/${COMPANY}/u-1/2026-04-30`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.publicUrl).toMatch(/\.json$/);
  });

  it("rejects application/json outside of training_data/", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "leak.json",
        contentType: "application/json",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/uploads/presign — content-type pinning", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser());
  });

  it("includes content-type in the signed-headers set so the client PUT must match", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.png",
        contentType: "image/png",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    await POST(req);
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const opts = getSignedUrlMock.mock.calls[0][2] as {
      expiresIn: number;
      signableHeaders?: Set<string>;
    };
    expect(opts.expiresIn).toBe(7200);
    expect(opts.signableHeaders?.has("content-type")).toBe(true);
  });
});

describe("POST /api/uploads/presign — rate limit", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser());
  });

  it("returns 429 when the per-uid rate limit is exceeded", async () => {
    rateLimitMock.mockResolvedValue({
      exceeded: true,
      count: 31,
      retryAfterSec: 42,
    });
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.jpg",
        contentType: "image/jpeg",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });
});

describe("POST /api/uploads/presign — STORAGE_BACKEND fallback", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", activeUser());
    process.env.STORAGE_BACKEND = "supabase";
  });

  it("urlencoded presign routes to Supabase when STORAGE_BACKEND=supabase", async () => {
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "x.jpg",
        contentType: "image/jpeg",
        folder: `projects/${COMPANY}/p1`,
      },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(supabaseSignedUrlMock).toHaveBeenCalledTimes(1);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("allows overwrite only for a validated stable expense receipt key", async () => {
    usersByUid.set("u1", activeUser({ id: USER }));
    const POST = await loadRoute();
    const req = urlencodedRequest(
      {
        filename: "ignored.jpg",
        contentType: "image/jpeg",
        folder: "ignored",
        purpose: "expense_receipt",
        expenseId: EXPENSE,
        uploadId: UPLOAD,
        variant: "thumbnail",
      },
      { Authorization: "Bearer ok" }
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(supabaseSignedUrlMock).toHaveBeenCalledWith(
      `expenses/${COMPANY}/${USER}/${EXPENSE}/${UPLOAD}-thumbnail.jpg`,
      { upsert: true }
    );
  });

  // Multipart (direct upload) STORAGE_BACKEND fallback covered by
  // structural parity with the urlencoded/JSON cases above; multipart
  // e2e lives in Playwright.
});
