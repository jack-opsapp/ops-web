import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { resolveSyncEngineEmailActor } from "@/lib/email/sync-engine-email-actor";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000003";
const INTERNAL_THREAD_ID = "00000000-0000-4000-8000-000000000004";
const PROVIDER_THREAD_ID = "provider-thread-1";
const ASSIGNEE_ID = "00000000-0000-4000-8000-000000000005";

function createDatabase(row: Record<string, unknown> | null) {
  const filters: Array<{ column: string; value: unknown }> = [];
  const db = {
    from(table: string) {
      expect(table).toBe("email_threads");
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return query;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { db, filters };
}

describe("resolveSyncEngineEmailActor", () => {
  it("binds the assigned actor resolver to the exact lead/mailbox/thread tuple", async () => {
    const { db, filters } = createDatabase({ id: INTERNAL_THREAD_ID });
    const actorResolver = vi.fn(async () => ({
      kind: "resolved" as const,
      context: {
        actorUserId: ASSIGNEE_ID,
        assignmentVersion: 4,
      },
    }));

    const result = await resolveSyncEngineEmailActor({
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      operation: "read",
      opportunityAction: "convert",
      supabase: db,
      actorResolver: actorResolver as never,
    });

    expect(filters).toEqual(
      expect.arrayContaining([
        { column: "company_id", value: COMPANY_ID },
        { column: "connection_id", value: CONNECTION_ID },
        { column: "provider_thread_id", value: PROVIDER_THREAD_ID },
        { column: "opportunity_id", value: OPPORTUNITY_ID },
      ])
    );
    expect(actorResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        internalThreadId: INTERNAL_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        operation: "read",
        opportunityAction: "convert",
        supabase: db,
      })
    );
    expect(result).toMatchObject({
      kind: "resolved",
      context: { actorUserId: ASSIGNEE_ID, assignmentVersion: 4 },
    });
  });

  it("fails closed before actor resolution when the exact thread tuple is absent", async () => {
    const { db } = createDatabase(null);
    const actorResolver = vi.fn();

    await expect(
      resolveSyncEngineEmailActor({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        operation: "send",
        supabase: db,
        actorResolver: actorResolver as never,
      })
    ).resolves.toEqual({ kind: "no_work", reason: "thread_not_found" });
    expect(actorResolver).not.toHaveBeenCalled();
  });
});
