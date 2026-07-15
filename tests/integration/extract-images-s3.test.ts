import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (_callback: () => void | Promise<void>) => undefined,
  };
});

const getConnectionMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: (id: string) => getConnectionMock(id),
    getProvider: (...args: unknown[]) => getProviderMock(...args),
  },
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, fn: () => Promise<unknown>) => fn(),
}));

interface ActivityRow {
  id: string;
  company_id: string;
  email_connection_id: string;
  email_thread_id: string;
  email_message_id: string | null;
  opportunity_id: string;
  type: "email";
}

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] };

let jobRow: {
  id: string;
  connection_id: string;
  company_id: string;
} | null;
let jobError: { message: string } | null;
let activityRows: ActivityRow[];
let activityError: { message: string } | null;
let scanUpsertError: { message: string } | null;

const scanUpserts: Array<{
  rows: Array<Record<string, unknown>>;
  options: Record<string, unknown> | undefined;
}> = [];

function filteredActivities(filters: Filter[]): ActivityRow[] {
  return activityRows.filter((row) =>
    filters.every((filter) => {
      const value = row[filter.column as keyof ActivityRow];
      return filter.kind === "eq"
        ? value === filter.value
        : filter.values.includes(value);
    })
  );
}

function queryBuilder(table: string) {
  const filters: Filter[] = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push({ kind: "eq", column, value });
      return builder;
    }),
    in: vi.fn((column: string, values: unknown[]) => {
      filters.push({ kind: "in", column, values });
      return builder;
    }),
    single: vi.fn(async () =>
      table === "gmail_scan_jobs"
        ? { data: jobRow, error: jobError }
        : { data: null, error: null }
    ),
    upsert: vi.fn(
      async (
        rows: Array<Record<string, unknown>>,
        options?: Record<string, unknown>
      ) => {
        if (table === "email_attachment_scans") {
          scanUpserts.push({ rows, options });
          return { data: null, error: scanUpsertError };
        }
        return { data: null, error: null };
      }
    ),
    then: (
      resolveResult: (value: {
        data: ActivityRow[] | null;
        error: { message: string } | null;
      }) => unknown,
      rejectResult?: (reason: unknown) => unknown
    ) =>
      Promise.resolve(
        table === "activities"
          ? { data: filteredActivities(filters), error: activityError }
          : { data: null, error: null }
      ).then(resolveResult, rejectResult),
  };
  return builder;
}

const supabaseMock = {
  from: vi.fn((table: string) => queryBuilder(table)),
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabaseMock,
}));

async function loadRoute() {
  const mod = await import("@/app/api/integrations/email/extract-images/route");
  return mod.POST;
}

function jsonRequest(body: unknown, secret = "test-secret"): NextRequest {
  return new Request("http://localhost/api/integrations/email/extract-images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const validPayload = {
  jobId: "job-1",
  connectionId: "connection-1",
  companyId: "company-1",
  oppThreadPayload: [
    {
      opportunityId: "opportunity-1",
      threadIds: ["thread-1"],
      allowedSenders: ["client@example.com"],
    },
  ],
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  getConnectionMock.mockResolvedValue({
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
  });
  jobRow = {
    id: "job-1",
    connection_id: "connection-1",
    company_id: "company-1",
  };
  jobError = null;
  activityRows = [
    {
      id: "activity-1",
      company_id: "company-1",
      email_connection_id: "connection-1",
      email_thread_id: "thread-1",
      email_message_id: "message-1",
      opportunity_id: "opportunity-1",
      type: "email",
    },
  ];
  activityError = null;
  scanUpsertError = null;
  scanUpserts.length = 0;
});

describe("POST /api/integrations/email/extract-images compatibility", () => {
  it("rejects requests missing required fields", async () => {
    const POST = await loadRoute();
    const response = await POST(jsonRequest({ jobId: "job-1" }));
    expect(response.status).toBe(400);
  });

  it("rejects a connection outside the requested company", async () => {
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "another-company",
      provider: "gmail",
    });
    const POST = await loadRoute();
    const response = await POST(jsonRequest(validPayload));
    expect(response.status).toBe(404);
  });

  it("rejects a job outside the exact connection and company", async () => {
    jobRow = { ...jobRow!, company_id: "another-company" };
    const POST = await loadRoute();
    const response = await POST(jsonRequest(validPayload));
    expect(response.status).toBe(404);
  });

  it("enqueues exact activity scan rows without reading provider bytes", async () => {
    const POST = await loadRoute();
    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, scanCandidates: 1 });
    expect(scanUpserts).toEqual([
      {
        rows: [
          {
            company_id: "company-1",
            connection_id: "connection-1",
            activity_id: "activity-1",
            provider_thread_id: "thread-1",
            message_id: "message-1",
            status: "pending",
          },
        ],
        options: {
          onConflict: "activity_id",
          ignoreDuplicates: true,
        },
      },
    ]);
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("deduplicates one activity repeated by legacy opportunity payloads", async () => {
    const POST = await loadRoute();
    const response = await POST(
      jsonRequest({
        ...validPayload,
        oppThreadPayload: [
          ...validPayload.oppThreadPayload,
          ...validPayload.oppThreadPayload,
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, scanCandidates: 1 });
    expect(scanUpserts).toHaveLength(1);
    expect(scanUpserts[0].rows).toHaveLength(1);
  });

  it("ignores legacy thread entries that have no exact provider message activity", async () => {
    activityRows = [
      {
        id: "activity-without-message",
        company_id: "company-1",
        email_connection_id: "connection-1",
        email_thread_id: "thread-1",
        email_message_id: null,
        opportunity_id: "opportunity-1",
        type: "email",
      },
    ];
    const POST = await loadRoute();
    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, scanCandidates: 0 });
    expect(scanUpserts).toEqual([]);
  });

  it("fails closed when exact activities cannot be read", async () => {
    activityError = { message: "database unavailable" };
    const POST = await loadRoute();
    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(500);
    expect(scanUpserts).toEqual([]);
  });

  it("fails closed when scan rows cannot be queued", async () => {
    scanUpsertError = { message: "queue unavailable" };
    const POST = await loadRoute();
    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(500);
  });
});

describe("legacy import attachment path source contract", () => {
  const importSource = readFileSync(
    resolve(process.cwd(), "src/app/api/integrations/email/import/route.ts"),
    "utf8"
  );
  const compatibilitySource = readFileSync(
    resolve(
      process.cwd(),
      "src/app/api/integrations/email/extract-images/route.ts"
    ),
    "utf8"
  );

  it("does not dispatch the retired extract-images route after import", () => {
    expect(importSource).not.toContain(
      "/api/integrations/email/extract-images"
    );
    expect(importSource).toContain('.from("email_attachment_scans")');
    expect(importSource).toContain('onConflict: "activity_id"');
    expect(importSource).toContain("ignoreDuplicates: true");
  });

  it("contains no public upload or opportunity image overwrite path", () => {
    expect(compatibilitySource).not.toContain("PutObjectCommand");
    expect(compatibilitySource).not.toContain("buildPublicS3Url");
    expect(compatibilitySource).not.toContain('storage.from("images")');
    expect(compatibilitySource).not.toMatch(
      /from\(["']opportunities["']\)[\s\S]*update\(\{\s*images:/
    );
    expect(compatibilitySource).not.toContain("getImageAttachmentsFromThread");
  });
});
