import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { classifyAndUpdateMock, getServiceRoleClientMock } = vi.hoisted(() => ({
  classifyAndUpdateMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    classifyAndUpdate: classifyAndUpdateMock,
  },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, callback: () => Promise<unknown>) =>
    callback(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: vi.fn(),
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: vi.fn(),
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: vi.fn(),
}));

vi.mock("@/lib/types/email-thread", () => ({
  mapEmailThreadFromDb: (row: ThreadRow) => ({
    id: row.id,
    companyId: row.company_id,
    connectionId: row.connection_id,
    providerThreadId: row.provider_thread_id,
    primaryCategory: row.primary_category,
    categoryManuallySet: row.category_manually_set,
  }),
}));

import { POST } from "@/app/api/inbox/reclassify/route";

interface ThreadRow {
  id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  primary_category: string;
  category_manually_set: boolean;
  category_classified_at: string | null;
  last_message_at: string;
  ai_summary: string | null;
}

interface QueryResult {
  data: ThreadRow[] | null;
  error: null;
  count?: number;
}

interface QueryFilter {
  column: keyof ThreadRow;
  value: unknown;
}

class FakeQuery implements PromiseLike<QueryResult> {
  readonly filters: QueryFilter[] = [];
  private head = false;
  private limitValue: number | null = null;
  private orderColumn: keyof ThreadRow | null = null;
  private orderAscending = true;

  constructor(private readonly rows: ThreadRow[]) {}

  select(
    _columns: string,
    options?: { count?: "exact"; head?: boolean }
  ): FakeQuery {
    this.head = options?.head === true;
    return this;
  }

  eq(column: keyof ThreadRow, value: unknown): FakeQuery {
    this.filters.push({ column, value });
    return this;
  }

  is(column: keyof ThreadRow, value: unknown): FakeQuery {
    this.filters.push({ column, value });
    return this;
  }

  order(column: keyof ThreadRow, options: { ascending: boolean }): FakeQuery {
    this.orderColumn = column;
    this.orderAscending = options.ascending;
    return this;
  }

  limit(value: number): FakeQuery {
    this.limitValue = value;
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    let matched = this.rows.filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value)
    );
    if (this.orderColumn) {
      const column = this.orderColumn;
      const direction = this.orderAscending ? 1 : -1;
      matched = [...matched].sort(
        (left, right) =>
          String(left[column]).localeCompare(String(right[column])) * direction
      );
    }
    const count = matched.length;
    if (this.limitValue !== null) matched = matched.slice(0, this.limitValue);
    return this.head
      ? { data: null, error: null, count }
      : { data: matched, error: null };
  }
}

class FakeSupabase {
  readonly queries: FakeQuery[] = [];

  constructor(readonly rows: ThreadRow[]) {}

  from(table: string): FakeQuery {
    if (table !== "email_threads") {
      throw new Error(`Unexpected table: ${table}`);
    }
    const query = new FakeQuery(this.rows);
    this.queries.push(query);
    return query;
  }
}

function makeThread(
  id: string,
  options: {
    manuallySet: boolean;
    category: string;
    lastMessageAt: string;
  }
): ThreadRow {
  return {
    id,
    company_id: "company-1",
    connection_id: "connection-1",
    provider_thread_id: `provider-${id}`,
    primary_category: options.category,
    category_manually_set: options.manuallySet,
    category_classified_at: null,
    last_message_at: options.lastMessageAt,
    ai_summary: null,
  };
}

function request(limit = 200): NextRequest {
  return new NextRequest(
    `https://app.opsapp.co/api/inbox/reclassify?companyId=company-1&limit=${limit}`,
    {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret" },
    }
  );
}

function classifyAndPersist(db: FakeSupabase) {
  classifyAndUpdateMock.mockImplementation(
    async (thread: {
      id: string;
      primaryCategory: string;
      categoryManuallySet: boolean;
    }) => {
      const row = db.rows.find((candidate) => candidate.id === thread.id);
      if (!row) throw new Error(`Missing thread ${thread.id}`);
      row.category_classified_at = "2026-07-14T20:00:00.000Z";
      row.ai_summary = "Refreshed summary";
      return {
        ...thread,
        primaryCategory: thread.primaryCategory,
        aiSummary: row.ai_summary,
      };
    }
  );
}

describe("POST /api/inbox/reclassify manual-category dirty threads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("sends an unclassified manual-category thread through classifyAndUpdate", async () => {
    const db = new FakeSupabase([
      makeThread("manual-dirty", {
        manuallySet: true,
        category: "VENDOR",
        lastMessageAt: "2026-07-14T19:00:00.000Z",
      }),
    ]);
    getServiceRoleClientMock.mockReturnValue(db);
    classifyAndPersist(db);

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      scanned: 1,
      classified: 1,
      errors: 0,
      remaining: 0,
    });
    expect(classifyAndUpdateMock).toHaveBeenCalledOnce();
    expect(classifyAndUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "manual-dirty",
        primaryCategory: "VENDOR",
        categoryManuallySet: true,
      })
    );
    expect(db.rows[0]).toMatchObject({
      primary_category: "VENDOR",
      ai_summary: "Refreshed summary",
    });
  });

  it("counts an unclassified manual-category thread remaining outside the page", async () => {
    const db = new FakeSupabase([
      makeThread("automatic-newest", {
        manuallySet: false,
        category: "OTHER",
        lastMessageAt: "2026-07-14T19:00:00.000Z",
      }),
      makeThread("manual-older", {
        manuallySet: true,
        category: "VENDOR",
        lastMessageAt: "2026-07-14T18:00:00.000Z",
      }),
    ]);
    getServiceRoleClientMock.mockReturnValue(db);
    classifyAndPersist(db);

    const response = await POST(request(1));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      scanned: 1,
      classified: 1,
      errors: 0,
      remaining: 1,
    });
    expect(classifyAndUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "automatic-newest" })
    );
  });
});
