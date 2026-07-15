import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

import { ensureApprovalDraftHistory } from "@/lib/api/services/approval-draft-provenance";

type Row = Record<string, unknown>;

function makeSupabase() {
  const updates: Row[] = [];
  const inserts: Row[] = [];
  const filters: Array<[string, unknown]> = [];

  const from = vi.fn((table: string) => {
    expect(table).toBe("ai_draft_history");
    const query = {
      update(values: Row) {
        updates.push(values);
        return query;
      },
      insert(values: Row) {
        inserts.push(values);
        return query;
      },
      select() {
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return query;
      },
      is(column: string, value: unknown) {
        filters.push([column, value]);
        return query;
      },
      async single() {
        return { data: { id: "new-draft-history" }, error: null };
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null
      ) {
        return Promise.resolve({ data: null, error: null }).then(
          onfulfilled,
          onrejected
        );
      },
    };
    return query;
  });

  return { client: { from }, updates, inserts, filters };
}

const baseInput = {
  companyId: "company-1",
  userId: "user-1",
  connectionId: "connection-1",
  originalDraft: "Original body",
  subject: "Original subject",
  profileType: "client_active_project",
  opportunityId: "opportunity-1",
  threadId: "thread-1",
};

describe("approval draft provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses a generated row without overwriting its existing subject provenance", async () => {
    const supabase = makeSupabase();
    requireSupabaseMock.mockReturnValue(supabase.client);

    await expect(
      ensureApprovalDraftHistory({
        ...baseInput,
        draftHistoryId: "existing-draft-history",
      })
    ).resolves.toBe("existing-draft-history");

    expect(supabase.inserts).toHaveLength(0);
    expect(supabase.updates).toEqual([{ subject: "Original subject" }]);
    expect(supabase.filters).toEqual(
      expect.arrayContaining([
        ["id", "existing-draft-history"],
        ["company_id", "company-1"],
        ["user_id", "user-1"],
        ["subject", null],
      ])
    );
  });

  it("creates a complete reply fallback history row with thread provenance", async () => {
    const supabase = makeSupabase();
    requireSupabaseMock.mockReturnValue(supabase.client);

    await expect(
      ensureApprovalDraftHistory({ ...baseInput, draftHistoryId: null })
    ).resolves.toBe("new-draft-history");

    expect(supabase.inserts).toEqual([
      expect.objectContaining({
        company_id: "company-1",
        user_id: "user-1",
        connection_id: "connection-1",
        opportunity_id: "opportunity-1",
        thread_id: "thread-1",
        original_draft: "Original body",
        subject: "Original subject",
        subject_source: "thread",
        profile_type: "client_active_project",
        status: "drafted",
      }),
    ]);
  });

  it("records configured provenance for a new-thread system fallback", async () => {
    const supabase = makeSupabase();
    requireSupabaseMock.mockReturnValue(supabase.client);

    await ensureApprovalDraftHistory({
      ...baseInput,
      draftHistoryId: null,
      threadId: null,
    });

    expect(supabase.inserts[0]).toMatchObject({
      subject: "Original subject",
      subject_source: "configured",
      thread_id: null,
    });
  });

  it("locks proposal fields without relabeling a learned subject", async () => {
    const supabase = makeSupabase();
    requireSupabaseMock.mockReturnValue(supabase.client);

    await ensureApprovalDraftHistory({
      ...baseInput,
      draftHistoryId: "generated-draft-history",
      atProposal: true,
    });

    expect(supabase.updates).toEqual([
      {
        subject: "Original subject",
        profile_type: "client_active_project",
      },
    ]);
    expect(supabase.filters).not.toContainEqual(["subject", null]);
  });

  it("records explicit operator provenance on a newly-created fallback row", async () => {
    const supabase = makeSupabase();
    requireSupabaseMock.mockReturnValue(supabase.client);

    await ensureApprovalDraftHistory({
      ...baseInput,
      draftHistoryId: null,
      subjectSource: "operator",
      origin: "operator",
    });

    expect(supabase.inserts[0]).toMatchObject({
      subject: "Original subject",
      subject_source: "operator",
      origin: "operator",
    });
  });
});
