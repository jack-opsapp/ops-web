/**
 * Integration tests for POST /api/bug-reports/screenshot after the
 * Phase 1 cutover.
 *
 * Verifies:
 *   - Auth + company-membership + reporter checks fire as before.
 *   - On STORAGE_BACKEND=s3 (default): the file is sent to S3 with
 *     `Bucket=ops-app-files-prod`, `Key=bug-reports/{co}/{rid}/screenshot.{ext}`,
 *     and the row's `screenshot_url` is persisted with the `s3:`
 *     scheme prefix the reader can detect.
 *   - On STORAGE_BACKEND=supabase: the file is uploaded to the legacy
 *     private Supabase bucket and `screenshot_url` is the bucket-
 *     relative path (no `s3:` prefix) — preserving existing reader
 *     behavior for rollback.
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
  const actual = await vi.importActual<typeof import("@/lib/s3/client")>(
    "@/lib/s3/client"
  );
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

/**
 * Build a mock NextRequest with a pre-populated `formData()` and
 * `headers.get()`. The route only uses these two surfaces; standing
 * up a real Request body in vitest+jsdom is impractical because
 * undici's multipart parser cannot reconstruct File entries from a
 * hand-rolled body.
 */
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
    // jsdom's File implementation lacks `.arrayBuffer()`. Build the
    // smallest object that exposes the surface the route actually uses
    // (`type`, `size`, `arrayBuffer()`).
    const fileLike = {
      type: file.contentType,
      size: file.content.byteLength,
      name: file.filename,
      arrayBuffer: async () => file.content.buffer.slice(
        file.content.byteOffset,
        file.content.byteOffset + file.content.byteLength
      ),
    } as unknown as FormDataEntryValue;
    formEntries.set("file", fileLike);
  }

  // HTTP header lookups are case-insensitive; mirror that here so the
  // route's `req.headers.get("authorization")` finds the test's
  // "Authorization" key.
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

describe("POST /api/bug-reports/screenshot — auth + ownership", () => {
  it("rejects missing Authorization with 401", async () => {
    const POST = await loadRoute();
    const req = makeRequest(
      { reportId: REPORT_ID, companyId: COMPANY },
      { content: new Uint8Array([1]), filename: "s.png", contentType: "image/png" }
    );
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it("rejects when caller's company differs from form companyId with 403", async () => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", { id: USER_ID, company_id: "different-company" });
    const POST = await loadRoute();
    const req = makeRequest(
      { reportId: REPORT_ID, companyId: COMPANY },
      { content: new Uint8Array([1]), filename: "s.png", contentType: "image/png" },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/bug-reports/screenshot — S3 backend (default)", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", { id: USER_ID, company_id: COMPANY });
    reportsById.set(REPORT_ID, {
      id: REPORT_ID,
      company_id: COMPANY,
      reporter_id: USER_ID,
    });
  });

  it("uploads to S3 with the expected key and persists the s3: prefix on the row", async () => {
    const POST = await loadRoute();
    const req = makeRequest(
      { reportId: REPORT_ID, companyId: COMPANY },
      { content: new Uint8Array([1, 2, 3]), filename: "s.png", contentType: "image/png" },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(s3SendMock).toHaveBeenCalledTimes(1);
    const cmd = s3SendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input.Bucket).toBe("ops-app-files-prod");
    expect(cmd.input.Key).toBe(`bug-reports/${COMPANY}/${REPORT_ID}/screenshot.png`);
    expect(cmd.input.ContentType).toBe("image/png");

    expect(json.path).toBe(
      `s3:bug-reports/${COMPANY}/${REPORT_ID}/screenshot.png`
    );
    expect(supabaseUploadMock).not.toHaveBeenCalled();

    const update = bugReportUpdates.find((u) => u.id === REPORT_ID);
    expect(update?.patch.screenshot_url).toBe(
      `s3:bug-reports/${COMPANY}/${REPORT_ID}/screenshot.png`
    );
  });
});

describe("POST /api/bug-reports/screenshot — Supabase backend (rollback)", () => {
  beforeEach(() => {
    process.env.STORAGE_BACKEND = "supabase";
    verifyAuthTokenMock.mockResolvedValue({ uid: "u1", claims: {} });
    usersByUid.set("u1", { id: USER_ID, company_id: COMPANY });
    reportsById.set(REPORT_ID, {
      id: REPORT_ID,
      company_id: COMPANY,
      reporter_id: USER_ID,
    });
  });

  it("uploads to Supabase and persists a bucket-relative path (no s3: prefix)", async () => {
    const POST = await loadRoute();
    const req = makeRequest(
      { reportId: REPORT_ID, companyId: COMPANY },
      { content: new Uint8Array([1, 2, 3]), filename: "s.jpg", contentType: "image/jpeg" },
      { Authorization: "Bearer ok" }
    );
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(supabaseUploadMock).toHaveBeenCalledTimes(1);
    const [path] = supabaseUploadMock.mock.calls[0] as [string];
    expect(path).toBe(`${COMPANY}/${REPORT_ID}/screenshot.jpg`);
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(json.path).toBe(`${COMPANY}/${REPORT_ID}/screenshot.jpg`);
    expect(json.path.startsWith("s3:")).toBe(false);
  });
});
