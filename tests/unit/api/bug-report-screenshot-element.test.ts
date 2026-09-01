/**
 * POST /api/bug-reports/screenshot — element-crop extension (bug 1f2bf7e9).
 *
 * The element picker uploads each cropped element through the same route the
 * full screenshot uses, with `kind=element&index=n`. Crops land beside the
 * screenshot at `bug-reports/{co}/{rid}/element-{n}.png` and are appended to
 * `bug_reports.additional_attachments` in arrival order.
 *
 * Harness mirrors `tests/integration/bug-reports-screenshot-s3.test.ts` — the
 * same Supabase/S3 stubs, extended so the report row carries
 * `additional_attachments` and the write-back is observable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const verifyAuthTokenMock = vi.fn();
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: (token: string) => verifyAuthTokenMock(token),
}));

interface UserRow {
  id: string;
  company_id: string;
}
interface ReportRow {
  id: string;
  company_id: string;
  reporter_id: string;
  additional_attachments: string[] | null;
}

const usersByUid = new Map<string, UserRow | null>();
const reportsById = new Map<string, ReportRow | null>();
const bugReportUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];

const supabaseUploadMock = vi.fn();

function makeSupabaseStub() {
  return {
    from: (table: string) => {
      if (table === "users") {
        let uidFilter = "";
        const b = {
          select: () => b,
          or: (clause: string) => {
            const m = clause.match(/auth_id\.eq\.([^,]+)/);
            uidFilter = m?.[1] ?? "";
            return b;
          },
          maybeSingle: async () => ({ data: usersByUid.get(uidFilter) ?? null, error: null }),
        };
        return b;
      }
      if (table === "bug_reports") {
        let idFilter = "";
        let pendingUpdate: Record<string, unknown> | null = null;
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          eq: (_col: string, val: string) => {
            idFilter = val;
            if (pendingUpdate) {
              bugReportUpdates.push({ id: idFilter, patch: pendingUpdate });
              pendingUpdate = null;
              return Promise.resolve({ error: null });
            }
            return b;
          },
          maybeSingle: async () => ({ data: reportsById.get(idFilter) ?? null, error: null }),
          update: (vals: Record<string, unknown>) => {
            pendingUpdate = vals;
            return b;
          },
        });
        return b;
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
    storage: {
      from: () => ({
        upload: (path: string, body: unknown, opts: unknown) =>
          supabaseUploadMock(path, body, opts),
      }),
    },
  };
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeSupabaseStub(),
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

vi.mock("@/lib/s3/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/s3/client")>("@/lib/s3/client");
  return {
    ...actual,
    getS3Client: () => ({ send: (cmd: unknown) => s3SendMock(cmd) }),
  };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadRoute() {
  const mod = await import("@/app/api/bug-reports/screenshot/route");
  return mod.POST;
}

function makeRequest(
  fields: Record<string, string>,
  file: { content: Uint8Array; filename: string; contentType: string } | null,
  headers: Record<string, string> = {}
): unknown {
  const formEntries = new Map<string, FormDataEntryValue>();
  for (const [k, v] of Object.entries(fields)) {
    formEntries.set(k, v);
  }
  if (file) {
    // jsdom's File lacks `.arrayBuffer()`; expose only what the route uses.
    const fileLike = {
      type: file.contentType,
      size: file.content.byteLength,
      name: file.filename,
      arrayBuffer: async () =>
        file.content.buffer.slice(
          file.content.byteOffset,
          file.content.byteOffset + file.content.byteLength
        ),
    } as unknown as FormDataEntryValue;
    formEntries.set("file", fileLike);
  }

  const lowercased = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );

  return {
    headers: {
      get: (name: string) => lowercased.get(name.toLowerCase()) ?? null,
    },
    formData: async () => ({
      get: (name: string) => formEntries.get(name) ?? null,
    }),
  };
}

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-row-id";
const REPORT_ID = "report-row-id";
const PNG = { content: new Uint8Array([1, 2, 3]), filename: "e.png", contentType: "image/png" };

function elementRequest(fields: Record<string, string> = {}) {
  return makeRequest(
    { reportId: REPORT_ID, companyId: COMPANY, kind: "element", index: "0", ...fields },
    PNG,
    { Authorization: "Bearer ok" }
  );
}

function seedAuthorized(additional: string[] | null = null) {
  verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
  usersByUid.set("u1", { id: USER_ID, company_id: COMPANY });
  reportsById.set(REPORT_ID, {
    id: REPORT_ID,
    company_id: COMPANY,
    reporter_id: USER_ID,
    additional_attachments: additional,
  });
}

beforeEach(() => {
  verifyAuthTokenMock.mockReset();
  s3SendMock.mockReset();
  s3SendMock.mockResolvedValue({});
  supabaseUploadMock.mockReset();
  supabaseUploadMock.mockResolvedValue({ error: null });
  usersByUid.clear();
  reportsById.clear();
  bugReportUpdates.length = 0;
  delete process.env.STORAGE_BACKEND;
  vi.resetModules();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("element crops — S3 backend", () => {
  it("stores the crop at element-{index}.png and appends it to additional_attachments", async () => {
    seedAuthorized(null);
    const POST = await loadRoute();
    const res = await POST(elementRequest({ index: "1" }) as never);

    expect(res.status).toBe(200);
    const json = await res.json();

    const key = `bug-reports/${COMPANY}/${REPORT_ID}/element-1.png`;
    const cmd = s3SendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input.Key).toBe(key);
    expect(cmd.input.Bucket).toBe("ops-app-files-prod");

    expect(json).toMatchObject({
      success: true,
      path: `s3:${key}`,
      attachmentIndex: 0,
    });

    const update = bugReportUpdates.find((u) => u.id === REPORT_ID);
    expect(update?.patch.additional_attachments).toEqual([`s3:${key}`]);
    // An element crop must never overwrite the full-page screenshot.
    expect(update?.patch).not.toHaveProperty("screenshot_url");
  });

  it("appends after existing attachments and reports the array position", async () => {
    const existing = `s3:bug-reports/${COMPANY}/${REPORT_ID}/element-0.png`;
    seedAuthorized([existing]);
    const POST = await loadRoute();
    const res = await POST(elementRequest({ index: "1" }) as never);

    const json = await res.json();
    expect(json.attachmentIndex).toBe(1);

    const update = bugReportUpdates.find((u) => u.id === REPORT_ID);
    expect(update?.patch.additional_attachments).toEqual([
      existing,
      `s3:bug-reports/${COMPANY}/${REPORT_ID}/element-1.png`,
    ]);
  });
});

describe("element crops — index validation", () => {
  const cases: Array<[string, Record<string, string> | null]> = [
    ["missing", null],
    ["non-integer", { index: "1.5" }],
    ["not a number", { index: "abc" }],
    ["negative", { index: "-1" }],
    ["above the cap", { index: "10" }],
  ];

  for (const [name, fields] of cases) {
    it(`rejects a ${name} index with 400`, async () => {
      seedAuthorized();
      const POST = await loadRoute();
      const req =
        fields === null
          ? makeRequest(
              { reportId: REPORT_ID, companyId: COMPANY, kind: "element" },
              PNG,
              { Authorization: "Bearer ok" }
            )
          : elementRequest(fields);

      const res = await POST(req as never);
      expect(res.status).toBe(400);
      expect(s3SendMock).not.toHaveBeenCalled();
      expect(bugReportUpdates).toHaveLength(0);
    });
  }
});

describe("element crops — untouched screenshot behavior", () => {
  it("keeps writing screenshot_url when kind is absent", async () => {
    seedAuthorized(["already-there"]);
    const POST = await loadRoute();
    const res = await POST(
      makeRequest({ reportId: REPORT_ID, companyId: COMPANY }, PNG, {
        Authorization: "Bearer ok",
      }) as never
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.path).toBe(`s3:bug-reports/${COMPANY}/${REPORT_ID}/screenshot.png`);
    expect(json).not.toHaveProperty("attachmentIndex");

    const update = bugReportUpdates.find((u) => u.id === REPORT_ID);
    expect(update?.patch.screenshot_url).toBe(
      `s3:bug-reports/${COMPANY}/${REPORT_ID}/screenshot.png`
    );
    expect(update?.patch).not.toHaveProperty("additional_attachments");
  });
});

describe("element crops — authorization", () => {
  it("rejects a company mismatch with 403", async () => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", { id: USER_ID, company_id: "another-company" });
    const POST = await loadRoute();
    const res = await POST(elementRequest() as never);
    expect(res.status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not the reporter with 403", async () => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", { id: USER_ID, company_id: COMPANY });
    reportsById.set(REPORT_ID, {
      id: REPORT_ID,
      company_id: COMPANY,
      reporter_id: "someone-else",
      additional_attachments: null,
    });
    const POST = await loadRoute();
    const res = await POST(elementRequest() as never);
    expect(res.status).toBe(403);
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer token with 401", async () => {
    const POST = await loadRoute();
    const res = await POST(
      makeRequest(
        { reportId: REPORT_ID, companyId: COMPANY, kind: "element", index: "0" },
        PNG
      ) as never
    );
    expect(res.status).toBe(401);
  });
});

describe("element crops — Supabase backend (rollback)", () => {
  it("writes to the legacy bucket path with no scheme prefix", async () => {
    process.env.STORAGE_BACKEND = "supabase";
    seedAuthorized(null);
    const POST = await loadRoute();
    const res = await POST(elementRequest({ index: "2" }) as never);

    expect(res.status).toBe(200);
    const json = await res.json();
    const path = `${COMPANY}/${REPORT_ID}/element-2.png`;

    expect(supabaseUploadMock).toHaveBeenCalledTimes(1);
    expect(supabaseUploadMock.mock.calls[0][0]).toBe(path);
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(json.path).toBe(path);
    expect(json.path.startsWith("s3:")).toBe(false);

    const update = bugReportUpdates.find((u) => u.id === REPORT_ID);
    expect(update?.patch.additional_attachments).toEqual([path]);
  });
});
