import { beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import type { NextRequest } from "next/server";

type AttachmentRow = {
  id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  message_id: string;
  attachment_id: string;
  filename: string | null;
  mime_type: string | null;
  detected_mime_type: string | null;
  size_bytes: number | null;
  verified_size_bytes: number | null;
  from_email: string | null;
  occurred_at: string | null;
  created_at: string | null;
  storage_backend: string | null;
  storage_path: string | null;
  source_url: string | null;
  ingest_status: string;
  attribution_status: string;
  opportunity_id: string | null;
};

type ConnectionRow = {
  id: string;
  company_id: string;
  type: "company" | "individual";
  user_id: string | null;
};

const state = vi.hoisted(() => ({
  authUser: { uid: "firebase-user", email: "operator@example.com" } as {
    uid: string;
    email: string;
  } | null,
  user: {
    id: "user-1",
    company_id: "11111111-1111-4111-8111-111111111111",
  } as { id: string; company_id: string } | null,
  canViewInbox: true,
  canViewCompany: false,
  canViewPipeline: false,
  attachmentRows: [] as AttachmentRow[],
  connectionRows: [] as ConnectionRow[],
  thread: null as null | {
    id: string;
    companyId: string;
    connectionId: string;
    providerThreadId: string;
  },
  storageDownload: vi.fn(),
  providerAttachmentWalk: vi.fn(),
  queryFilters: [] as Array<{
    table: string;
    filters: Record<string, unknown>;
  }>,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: vi.fn(async () => state.authUser),
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: vi.fn(async () => state.user),
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: vi.fn(async (_userId: string, permission: string) =>
    permission === "inbox.view"
      ? state.canViewInbox
      : permission === "inbox.view_company"
        ? state.canViewCompany
        : permission === "pipeline.view"
          ? state.canViewPipeline
          : false
  ),
}));

function matchingRows(
  table: string,
  filters: Record<string, unknown>
): Array<AttachmentRow | ConnectionRow> {
  state.queryFilters.push({ table, filters: { ...filters } });
  const rows =
    table === "email_attachments"
      ? state.attachmentRows
      : table === "email_connections"
        ? state.connectionRows
        : [];
  return rows.filter((row) =>
    Object.entries(filters).every(([column, value]) => {
      if (column.startsWith("__in:")) {
        const actualColumn = column.slice("__in:".length);
        return (value as unknown[]).includes(
          row[actualColumn as keyof (AttachmentRow | ConnectionRow)]
        );
      }
      return row[column as keyof (AttachmentRow | ConnectionRow)] === value;
    })
  );
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query: Record<string, unknown> = {};
      Object.assign(query, {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        in: (column: string, values: unknown[]) => {
          filters[`__in:${column}`] = values;
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data: matchingRows(table, filters)[0] ?? null,
          error: null,
        }),
        then: (
          resolve: (value: {
            data: Array<AttachmentRow | ConnectionRow>;
            error: null;
          }) => unknown
        ) =>
          Promise.resolve({
            data: matchingRows(table, filters),
            error: null,
          }).then(resolve),
      });
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        download: (key: string) => state.storageDownload(bucket, key),
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, task: () => Promise<unknown>) =>
    task(),
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    getThread: vi.fn(async () => state.thread),
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: vi.fn(async () => ({ id: "connection-1" })),
    getProvider: vi.fn(() => ({
      getAttachmentsFromThread: state.providerAttachmentWalk,
    })),
  },
}));

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";
const OPPORTUNITY_ID = "55555555-5555-4555-8555-555555555555";

function storedAttachment(
  overrides: Partial<AttachmentRow> = {}
): AttachmentRow {
  return {
    id: ATTACHMENT_ID,
    company_id: COMPANY_ID,
    connection_id: CONNECTION_ID,
    provider_thread_id: "thread-1",
    message_id: "message-1",
    attachment_id: "provider-attachment-1",
    filename: "deck-photo.jpg",
    mime_type: "image/jpeg",
    detected_mime_type: "image/jpeg",
    size_bytes: 3,
    verified_size_bytes: 3,
    from_email: "customer@example.com",
    occurred_at: "2026-07-14T22:00:00.000Z",
    created_at: "2026-07-14T22:00:00.000Z",
    storage_backend: "supabase",
    storage_path: `${COMPANY_ID}/${CONNECTION_ID}/message/attachment/content`,
    source_url: null,
    ingest_status: "stored",
    attribution_status: "attributed",
    opportunity_id: OPPORTUNITY_ID,
    ...overrides,
  };
}

function request(url: string): NextRequest {
  return new Request(url, {
    headers: { authorization: "Bearer test-token" },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  state.authUser = { uid: "firebase-user", email: "operator@example.com" };
  state.user = { id: "user-1", company_id: COMPANY_ID };
  state.canViewInbox = true;
  state.canViewCompany = false;
  state.canViewPipeline = false;
  state.attachmentRows = [];
  state.connectionRows = [
    {
      id: CONNECTION_ID,
      company_id: COMPANY_ID,
      type: "individual",
      user_id: "user-1",
    },
  ];
  state.thread = null;
  state.storageDownload.mockReset();
  state.providerAttachmentWalk.mockReset();
  state.queryFilters.length = 0;
  vi.resetModules();
});

describe("GET /api/integrations/email/attachment", () => {
  it("streams a stored canonical attachment using database metadata", async () => {
    state.attachmentRows = [storedAttachment()];
    state.storageDownload.mockResolvedValue({
      data: new NodeBlob([new Uint8Array([1, 2, 3])], { type: "text/plain" }),
      error: null,
    });

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="deck-photo.jpg"'
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(state.storageDownload).toHaveBeenCalledWith(
      "email-attachments",
      `${COMPANY_ID}/${CONNECTION_ID}/message/attachment/content`
    );
    expect(state.providerAttachmentWalk).not.toHaveBeenCalled();
  });

  it("hides another user's individual mailbox attachment from an inbox viewer", async () => {
    state.connectionRows = [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "individual",
        user_id: "user-2",
      },
    ];
    state.attachmentRows = [storedAttachment()];

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(404);
    expect(state.storageDownload).not.toHaveBeenCalled();
  });

  it("allows an inbox viewer to open an attachment from a shared company mailbox", async () => {
    state.connectionRows = [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "company",
        user_id: "user-2",
      },
    ];
    state.attachmentRows = [storedAttachment()];
    state.storageDownload.mockResolvedValue({
      data: new NodeBlob([new Uint8Array([1, 2, 3])]),
      error: null,
    });

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(200);
  });

  it("allows a company-wide inbox viewer to open another user's mailbox attachment", async () => {
    state.canViewCompany = true;
    state.connectionRows = [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "individual",
        user_id: "user-2",
      },
    ];
    state.attachmentRows = [storedAttachment()];
    state.storageDownload.mockResolvedValue({
      data: new NodeBlob([new Uint8Array([1, 2, 3])]),
      error: null,
    });

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(200);
  });

  it("allows a pipeline viewer who has no inbox permission", async () => {
    state.canViewInbox = false;
    state.canViewPipeline = true;
    state.connectionRows = [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "individual",
        user_id: "user-2",
      },
    ];
    state.attachmentRows = [storedAttachment()];
    state.storageDownload.mockResolvedValue({
      data: new NodeBlob([new Uint8Array([1, 2, 3])]),
      error: null,
    });

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(200);
  });

  it("does not treat an attributed flag without a lead as pipeline access", async () => {
    state.canViewInbox = false;
    state.canViewPipeline = true;
    state.attachmentRows = [storedAttachment({ opportunity_id: null })];

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(404);
    expect(state.storageDownload).not.toHaveBeenCalled();
  });

  it("does not expose an unattributed attachment through pipeline permission alone", async () => {
    state.canViewInbox = false;
    state.canViewPipeline = true;
    state.attachmentRows = [
      storedAttachment({ attribution_status: "needs_review" }),
    ];

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(404);
    expect(state.storageDownload).not.toHaveBeenCalled();
  });

  it("fails closed when the user has neither attachment-view permission", async () => {
    state.canViewInbox = false;
    state.canViewPipeline = false;
    state.attachmentRows = [storedAttachment()];

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(403);
    expect(state.storageDownload).not.toHaveBeenCalled();
  });

  it("does not treat company-wide inbox scope as a standalone view permission", async () => {
    state.canViewInbox = false;
    state.canViewCompany = true;
    state.canViewPipeline = false;
    state.attachmentRows = [storedAttachment()];

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(403);
    expect(state.storageDownload).not.toHaveBeenCalled();
  });

  it("rejects legacy provider identifiers without a canonical UUID", async () => {
    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        "https://ops.test/api/integrations/email/attachment?companyId=company&messageId=message&attachmentId=provider-attachment&mimeType=text%2Fhtml"
      )
    );

    expect(response.status).toBe(400);
    expect(state.storageDownload).not.toHaveBeenCalled();
    expect(state.providerAttachmentWalk).not.toHaveBeenCalled();
  });

  it("does not reveal a canonical row belonging to another company", async () => {
    state.attachmentRows = [
      storedAttachment({
        company_id: "99999999-9999-4999-8999-999999999999",
      }),
    ];

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(404);
    expect(state.storageDownload).not.toHaveBeenCalled();
  });

  it("forces documents to download and sanitizes the database filename", async () => {
    state.attachmentRows = [
      storedAttachment({
        filename: '../../unsafe"\r\n.pdf',
        mime_type: "application/pdf",
        detected_mime_type: "application/pdf",
      }),
    ];
    state.storageDownload.mockResolvedValue({
      data: new NodeBlob([new Uint8Array([37, 80, 68, 70])], {
        type: "text/html",
      }),
      error: null,
    });

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}&mimeType=text%2Fhtml`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="unsafe_.pdf"'
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox"
    );
  });

  it("serves the byte-detected MIME instead of untrusted provider metadata", async () => {
    state.attachmentRows = [
      storedAttachment({
        mime_type: "text/html",
        detected_mime_type: "image/jpeg",
      }),
    ];
    state.storageDownload.mockResolvedValue({
      data: new NodeBlob([new Uint8Array([0xff, 0xd8, 0xff])]),
      error: null,
    });

    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");
    const response = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toContain("inline");
  });

  it("does not stream a processing row or a non-Supabase object", async () => {
    const { GET } =
      await import("@/app/api/integrations/email/attachment/route");

    state.attachmentRows = [storedAttachment({ ingest_status: "processing" })];
    const processingResponse = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );
    expect(processingResponse.status).toBe(404);

    state.attachmentRows = [storedAttachment({ storage_backend: "external" })];
    const foreignBackendResponse = await GET(
      request(
        `https://ops.test/api/integrations/email/attachment?id=${ATTACHMENT_ID}`
      )
    );
    expect(foreignBackendResponse.status).toBe(404);
    expect(state.storageDownload).not.toHaveBeenCalled();
  });
});

describe("GET /api/inbox/threads/[id]/attachments", () => {
  it("returns stored rows for the exact thread company and mailbox", async () => {
    state.thread = {
      id: "thread-row-1",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      providerThreadId: "provider-thread-1",
    };
    state.attachmentRows = [
      {
        id: ATTACHMENT_ID,
        company_id: COMPANY_ID,
        connection_id: CONNECTION_ID,
        provider_thread_id: "provider-thread-1",
        message_id: "message-1",
        attachment_id: "provider-attachment-1",
        filename: "deck-photo.jpg",
        mime_type: "image/jpeg",
        detected_mime_type: "image/jpeg",
        size_bytes: 2_000_000,
        verified_size_bytes: 1_900_000,
        from_email: "customer@example.com",
        occurred_at: "2026-07-14T22:00:00.000Z",
        created_at: "2026-07-14T22:00:00.000Z",
        storage_backend: "supabase",
        storage_path: "stored/key",
        source_url: null,
        ingest_status: "stored",
        attribution_status: "attributed",
        opportunity_id: OPPORTUNITY_ID,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        company_id: COMPANY_ID,
        connection_id: CONNECTION_ID,
        provider_thread_id: "provider-thread-1",
        message_id: "message-2",
        attachment_id: "provider-attachment-2",
        filename: "still-downloading.pdf",
        mime_type: "application/pdf",
        detected_mime_type: "application/pdf",
        size_bytes: 500,
        verified_size_bytes: null,
        from_email: "customer@example.com",
        occurred_at: "2026-07-14T23:00:00.000Z",
        created_at: "2026-07-14T23:00:00.000Z",
        storage_backend: null,
        storage_path: null,
        source_url: null,
        ingest_status: "processing",
        attribution_status: "attributed",
        opportunity_id: OPPORTUNITY_ID,
      },
    ];
    state.providerAttachmentWalk.mockResolvedValue([]);

    const { GET } =
      await import("@/app/api/inbox/threads/[id]/attachments/route");
    const response = await GET(
      request("https://ops.test/api/inbox/threads/thread-row-1/attachments"),
      { params: Promise.resolve({ id: "thread-row-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.attachments).toEqual([
      {
        id: ATTACHMENT_ID,
        messageId: "message-1",
        attachmentId: "provider-attachment-1",
        filename: "deck-photo.jpg",
        mimeType: "image/jpeg",
        size: 1_900_000,
        fromEmail: "customer@example.com",
        date: "2026-07-14T22:00:00.000Z",
        availability: "stored",
        url: `/api/integrations/email/attachment?id=${ATTACHMENT_ID}&filename=deck-photo.jpg`,
      },
    ]);
    expect(state.queryFilters).toContainEqual({
      table: "email_attachments",
      filters: {
        company_id: COMPANY_ID,
        connection_id: CONNECTION_ID,
        provider_thread_id: "provider-thread-1",
        "__in:ingest_status": [
          "stored",
          "external",
          "oversized",
          "unavailable",
          "failed",
        ],
      },
    });
    expect(state.providerAttachmentWalk).not.toHaveBeenCalled();
  });

  it("returns linked and failed attachment metadata without broken file URLs", async () => {
    state.thread = {
      id: "thread-row-1",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      providerThreadId: "provider-thread-1",
    };
    state.attachmentRows = [
      storedAttachment({
        id: "44444444-4444-4444-8444-444444444444",
        provider_thread_id: "provider-thread-1",
        attachment_id: "reference-1",
        filename: "SharePoint folder",
        ingest_status: "external",
        storage_backend: null,
        storage_path: null,
        source_url: "https://sharepoint.example.com/site/folder",
      }),
      storedAttachment({
        id: "66666666-6666-4666-8666-666666666666",
        provider_thread_id: "provider-thread-1",
        attachment_id: "oversized-1",
        filename: "site-walk.mov",
        mime_type: "video/quicktime",
        detected_mime_type: "video/quicktime",
        ingest_status: "oversized",
        storage_backend: null,
        storage_path: null,
        source_url: null,
      }),
      storedAttachment({
        id: "77777777-7777-4777-8777-777777777777",
        provider_thread_id: "provider-thread-1",
        attachment_id: "failed-1",
        filename: "jobsite.jpg",
        ingest_status: "failed",
        storage_backend: null,
        storage_path: null,
        source_url: null,
      }),
    ];

    const { GET } =
      await import("@/app/api/inbox/threads/[id]/attachments/route");
    const response = await GET(
      request("https://ops.test/api/inbox/threads/thread-row-1/attachments"),
      { params: Promise.resolve({ id: "thread-row-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attachmentId: "reference-1",
          availability: "external",
          url: "https://sharepoint.example.com/site/folder",
        }),
        expect.objectContaining({
          attachmentId: "oversized-1",
          availability: "oversized",
          url: null,
        }),
        expect.objectContaining({
          attachmentId: "failed-1",
          availability: "failed",
          url: null,
        }),
      ])
    );
  });

  it("hides another user's individual mailbox thread attachments", async () => {
    state.connectionRows = [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "individual",
        user_id: "user-2",
      },
    ];
    state.thread = {
      id: "thread-row-1",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      providerThreadId: "provider-thread-1",
    };

    const { GET } =
      await import("@/app/api/inbox/threads/[id]/attachments/route");
    const response = await GET(
      request("https://ops.test/api/inbox/threads/thread-row-1/attachments"),
      { params: Promise.resolve({ id: "thread-row-1" }) }
    );

    expect(response.status).toBe(404);
    expect(state.queryFilters).not.toContainEqual(
      expect.objectContaining({ table: "email_attachments" })
    );
    expect(state.providerAttachmentWalk).not.toHaveBeenCalled();
  });

  it("returns attachments for a shared company mailbox thread", async () => {
    state.connectionRows = [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "company",
        user_id: "user-2",
      },
    ];
    state.thread = {
      id: "thread-row-1",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      providerThreadId: "provider-thread-1",
    };

    const { GET } =
      await import("@/app/api/inbox/threads/[id]/attachments/route");
    const response = await GET(
      request("https://ops.test/api/inbox/threads/thread-row-1/attachments"),
      { params: Promise.resolve({ id: "thread-row-1" }) }
    );

    expect(response.status).toBe(200);
  });

  it("returns another user's mailbox thread attachments for a company-wide viewer", async () => {
    state.canViewCompany = true;
    state.connectionRows = [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "individual",
        user_id: "user-2",
      },
    ];
    state.thread = {
      id: "thread-row-1",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      providerThreadId: "provider-thread-1",
    };

    const { GET } =
      await import("@/app/api/inbox/threads/[id]/attachments/route");
    const response = await GET(
      request("https://ops.test/api/inbox/threads/thread-row-1/attachments"),
      { params: Promise.resolve({ id: "thread-row-1" }) }
    );

    expect(response.status).toBe(200);
  });

  it("does not grant thread access through pipeline permission alone", async () => {
    state.canViewInbox = false;
    state.canViewPipeline = true;
    state.thread = {
      id: "thread-row-1",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      providerThreadId: "provider-thread-1",
    };

    const { GET } =
      await import("@/app/api/inbox/threads/[id]/attachments/route");
    const response = await GET(
      request("https://ops.test/api/inbox/threads/thread-row-1/attachments"),
      { params: Promise.resolve({ id: "thread-row-1" }) }
    );

    expect(response.status).toBe(403);
    expect(state.providerAttachmentWalk).not.toHaveBeenCalled();
  });
});
