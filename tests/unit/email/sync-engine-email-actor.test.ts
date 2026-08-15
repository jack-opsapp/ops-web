import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canonicalActor = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("@/lib/email/phase-c-email-actor", () => ({
  resolvePhaseCEmailActor: canonicalActor.resolve,
}));

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
  beforeEach(() => {
    canonicalActor.resolve.mockReset();
  });

  it("binds the assigned actor resolver to the exact lead/mailbox/thread tuple", async () => {
    const { db, filters } = createDatabase({ id: INTERNAL_THREAD_ID });
    canonicalActor.resolve.mockResolvedValue({
      kind: "resolved" as const,
      context: {
        actorUserId: ASSIGNEE_ID,
        assignmentVersion: 4,
      },
    });

    const result = await resolveSyncEngineEmailActor({
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      operation: "read",
      opportunityAction: "convert",
      supabase: db,
    });

    expect(filters).toEqual(
      expect.arrayContaining([
        { column: "company_id", value: COMPANY_ID },
        { column: "connection_id", value: CONNECTION_ID },
        { column: "provider_thread_id", value: PROVIDER_THREAD_ID },
        { column: "opportunity_id", value: OPPORTUNITY_ID },
      ])
    );
    expect(canonicalActor.resolve).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      expectedAssignmentVersion: undefined,
      operation: "read",
      opportunityAction: "convert",
    });
    expect(result).toMatchObject({
      kind: "resolved",
      context: { actorUserId: ASSIGNEE_ID, assignmentVersion: 4 },
    });
  });

  it("fails closed before actor resolution when the exact thread tuple is absent", async () => {
    const { db } = createDatabase(null);

    await expect(
      resolveSyncEngineEmailActor({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        operation: "send",
        supabase: db,
      })
    ).resolves.toEqual({ kind: "no_work", reason: "thread_not_found" });
    expect(canonicalActor.resolve).not.toHaveBeenCalled();
  });

  it("rejects a caller-supplied resolver instead of widening the canonical input", async () => {
    const { db } = createDatabase({ id: INTERNAL_THREAD_ID });
    const injectedResolver = vi.fn(async () => ({
      kind: "resolved" as const,
      context: {
        actorUserId: ASSIGNEE_ID,
        assignmentVersion: 4,
      },
    }));
    canonicalActor.resolve.mockResolvedValue({
      kind: "no_work",
      reason: "lead_thread_unauthorized",
    });

    await expect(
      resolveSyncEngineEmailActor({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        operation: "send",
        supabase: db,
        actorResolver: injectedResolver,
      } as never)
    ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
    expect(injectedResolver).not.toHaveBeenCalled();
    expect(canonicalActor.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ["company UUID", { companyId: "not-a-uuid" }],
    ["connection UUID", { connectionId: ` ${CONNECTION_ID}` }],
    [
      "opportunity UUID",
      { opportunityId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    ],
    ["blank provider thread", { providerThreadId: "" }],
    ["padded provider thread", { providerThreadId: " provider-thread-1" }],
    [
      "controlled provider thread",
      { providerThreadId: "provider\u0000thread" },
    ],
    ["oversized provider thread", { providerThreadId: "é".repeat(1_025) }],
    ["operation enum", { operation: "delete" }],
    ["opportunity action enum", { opportunityAction: "delete" }],
    ["assignment version", { expectedAssignmentVersion: -1 }],
    ["assignment version", { expectedAssignmentVersion: 1.5 }],
  ])(
    "rejects a noncanonical %s before any database call",
    async (_label, override) => {
      const { db, filters } = createDatabase({ id: INTERNAL_THREAD_ID });

      await expect(
        resolveSyncEngineEmailActor({
          companyId: COMPANY_ID,
          connectionId: CONNECTION_ID,
          opportunityId: OPPORTUNITY_ID,
          providerThreadId: PROVIDER_THREAD_ID,
          operation: "read",
          supabase: db,
          ...override,
        } as never)
      ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });

      expect(filters).toEqual([]);
      expect(canonicalActor.resolve).not.toHaveBeenCalled();
    }
  );

  it("rejects a noncanonical database thread identity before actor resolution", async () => {
    const { db } = createDatabase({ id: "not-a-uuid" });

    await expect(
      resolveSyncEngineEmailActor({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        operation: "read",
        supabase: db,
      })
    ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
    expect(canonicalActor.resolve).not.toHaveBeenCalled();
  });

  it("keeps one immutable authorization snapshot while the thread lookup is pending", async () => {
    let releaseLookup:
      | ((value: { data: { id: string }; error: null }) => void)
      | undefined;
    const pendingLookup = new Promise<{
      data: { id: string };
      error: null;
    }>((resolve) => {
      releaseLookup = resolve;
    });
    const filters: Array<{ column: string; value: unknown }> = [];
    const db = {
      from() {
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters.push({ column, value });
            return query;
          },
          maybeSingle() {
            return pendingLookup;
          },
        };
        return query;
      },
    } as unknown as SupabaseClient;
    canonicalActor.resolve.mockResolvedValue({
      kind: "no_work",
      reason: "lead_thread_unauthorized",
    });
    const mutableInput = {
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      operation: "send" as const,
      opportunityAction: "convert" as "convert" | undefined,
      expectedAssignmentVersion: 7 as number | null,
      supabase: db,
    };

    const resolution = resolveSyncEngineEmailActor(mutableInput);
    mutableInput.companyId = "00000000-0000-4000-8000-000000000099";
    mutableInput.connectionId = "00000000-0000-4000-8000-000000000098";
    mutableInput.opportunityId = "00000000-0000-4000-8000-000000000097";
    mutableInput.providerThreadId = "provider-thread-attacker";
    (mutableInput as { operation: "read" | "send" }).operation = "read";
    mutableInput.opportunityAction = undefined;
    mutableInput.expectedAssignmentVersion = 8;
    releaseLookup?.({ data: { id: INTERNAL_THREAD_ID }, error: null });

    await expect(resolution).resolves.toEqual({
      kind: "no_work",
      reason: "lead_thread_unauthorized",
    });
    expect(filters).toEqual([
      { column: "company_id", value: COMPANY_ID },
      { column: "connection_id", value: CONNECTION_ID },
      { column: "provider_thread_id", value: PROVIDER_THREAD_ID },
      { column: "opportunity_id", value: OPPORTUNITY_ID },
    ]);
    expect(canonicalActor.resolve).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      expectedAssignmentVersion: 7,
      operation: "send",
      opportunityAction: "convert",
    });
  });

  it("rejects accessor-backed authorization input without invoking the accessor", async () => {
    const { db } = createDatabase({ id: INTERNAL_THREAD_ID });
    let operationReads = 0;
    const hostileInput = {
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      opportunityAction: "convert",
      expectedAssignmentVersion: 7,
      supabase: db,
    } as Record<string, unknown>;
    Object.defineProperty(hostileInput, "operation", {
      enumerable: true,
      get() {
        operationReads += 1;
        return "read";
      },
    });

    await expect(
      resolveSyncEngineEmailActor(hostileInput as never)
    ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
    expect(operationReads).toBe(0);
    expect(canonicalActor.resolve).not.toHaveBeenCalled();
  });

  it("rejects symbols, hidden extras, and transparent proxies before lookup", async () => {
    const { db, filters } = createDatabase({ id: INTERNAL_THREAD_ID });
    const base = {
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      operation: "read" as const,
      supabase: db,
    };
    const withSymbol = { ...base } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("private-input")] = true;
    const withNonEnumerable = { ...base };
    Object.defineProperty(withNonEnumerable, "privateInput", {
      enumerable: false,
      value: true,
    });

    for (const input of [withSymbol, withNonEnumerable, new Proxy(base, {})]) {
      await expect(
        resolveSyncEngineEmailActor(input as never)
      ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
    }
    expect(filters).toEqual([]);
    expect(canonicalActor.resolve).not.toHaveBeenCalled();
  });

  it("contains hostile input descriptor traps before any lookup", async () => {
    const { db, filters } = createDatabase({ id: INTERNAL_THREAD_ID });
    const hostileInput = new Proxy(
      {
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        operation: "send" as const,
        supabase: db,
      },
      {
        getOwnPropertyDescriptor() {
          throw new Error("private descriptor details");
        },
      }
    );

    await expect(resolveSyncEngineEmailActor(hostileInput)).resolves.toEqual({
      kind: "no_work",
      reason: "lookup_failed",
    });
    expect(filters).toEqual([]);
    expect(canonicalActor.resolve).not.toHaveBeenCalled();
  });

  it("contains a thrown canonical thread lookup as generic no-work", async () => {
    const db = {
      from() {
        throw new Error("private database details");
      },
    } as unknown as SupabaseClient;

    await expect(
      resolveSyncEngineEmailActor({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        operation: "send",
        supabase: db,
      })
    ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
    expect(canonicalActor.resolve).not.toHaveBeenCalled();
  });

  it("contains a thrown canonical actor resolution as generic no-work", async () => {
    const { db } = createDatabase({ id: INTERNAL_THREAD_ID });
    canonicalActor.resolve.mockRejectedValue(
      new Error("private authorization details")
    );

    await expect(
      resolveSyncEngineEmailActor({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        operation: "send",
        supabase: db,
      })
    ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
  });
});
