import { Blob as NodeBlob } from "node:buffer";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  attachmentReads: 0,
  storageDownload: vi.fn(),
  resolveEmailOpportunityAccess: vi.fn(),
  resolveEmailRouteActor: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: state.resolveEmailRouteActor,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: state.resolveEmailOpportunityAccess,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: vi.fn(async () => ({
    uid: "firebase-subject",
    email: "login@example.com",
  })),
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: vi.fn(async () => ({
    id: "user-1",
    company_id: "11111111-1111-4111-8111-111111111111",
  })),
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: vi.fn(async () => true),
}));

vi.mock("@/lib/email/server-mailbox-access", () => ({
  canAccessEmailMailbox: vi.fn(async () => true),
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    getThread: vi.fn(async () => ({
      id: "thread-internal",
      companyId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      providerThreadId: "provider-thread",
    })),
  },
}));

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";
const OPPORTUNITY_ID = "44444444-4444-4444-8444-444444444444";
const actor = { userId: "user-1", companyId: COMPANY_ID } as const;

function query(table: string) {
  const filters: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  const attachment = {
    id: ATTACHMENT_ID,
    company_id: COMPANY_ID,
    connection_id: CONNECTION_ID,
    provider_thread_id: "provider-thread",
    opportunity_id: OPPORTUNITY_ID,
    message_id: "message-1",
    attachment_id: "provider-attachment-1",
    filename: "site-photo.jpg",
    mime_type: "image/jpeg",
    detected_mime_type: "image/jpeg",
    size_bytes: 3,
    verified_size_bytes: 3,
    from_email: "client@example.com",
    occurred_at: "2026-07-15T10:00:00.000Z",
    created_at: "2026-07-15T10:00:00.000Z",
    storage_backend: "supabase",
    storage_path: "private/site-photo.jpg",
    source_url: null,
    ingest_status: "stored",
    attribution_status: "attributed",
  };
  const rows =
    table === "email_attachments"
      ? [attachment]
      : table === "email_threads"
        ? [
            {
              id: "thread-internal",
              company_id: COMPANY_ID,
              connection_id: CONNECTION_ID,
              provider_thread_id: "provider-thread",
              opportunity_id: OPPORTUNITY_ID,
            },
          ]
        : [];
  const matching = () =>
    rows.filter((row) =>
      Object.entries(filters).every(([key, value]) => {
        if (key.startsWith("__in:")) {
          return (value as unknown[]).includes(
            row[key.slice(5) as keyof typeof row]
          );
        }
        return row[key as keyof typeof row] === value;
      })
    );
  Object.assign(builder, {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      filters[`__in:${column}`] = values;
      return builder;
    },
    order: () => builder,
    maybeSingle: async () => {
      if (table === "email_attachments") state.attachmentReads += 1;
      return { data: matching()[0] ?? null, error: null };
    },
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
      if (table === "email_attachments") state.attachmentReads += 1;
      return Promise.resolve({ data: matching(), error: null }).then(resolve);
    },
  });
  return builder;
}

const supabase = {
  from: (table: string) => query(table),
  storage: {
    from: () => ({ download: state.storageDownload }),
  },
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabase,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, task: () => Promise<unknown>) =>
    task(),
}));

function request(url: string): NextRequest {
  return new Request(url, {
    headers: { authorization: "Bearer test-token" },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  state.attachmentReads = 0;
  state.resolveEmailRouteActor.mockResolvedValue({ ok: true, actor });
  state.resolveEmailOpportunityAccess.mockResolvedValue({
    allowed: false,
    reason: "opportunity_other_assignee",
  });
  state.storageDownload.mockResolvedValue({
    data: new NodeBlob([new Uint8Array([1, 2, 3])]),
    error: null,
  });
});

describe("assigned attachment authorization", () => {
  it("denies thread attachment metadata before reading attachment rows", async () => {
    const { GET } =
      await import("@/app/api/inbox/threads/[id]/attachments/route");

    const response = await GET(
      request("https://ops.test/api/inbox/threads/thread-internal/attachments"),
      { params: Promise.resolve({ id: "thread-internal" }) }
    );

    expect(response.status).toBe(404);
    expect(state.attachmentReads).toBe(0);
  });

  it("denies stored bytes through the same canonical thread helper", async () => {
    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");

    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(404);
    expect(state.resolveEmailOpportunityAccess).toHaveBeenCalledWith({
      actor,
      operation: "read",
      threadId: "thread-internal",
      connectionId: CONNECTION_ID,
      providerThreadId: "provider-thread",
      opportunityId: OPPORTUNITY_ID,
      supabase,
    });
    expect(state.storageDownload).not.toHaveBeenCalled();
  });
});
