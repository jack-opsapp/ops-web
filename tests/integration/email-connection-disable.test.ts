import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { deleteConnectionMock, requireSupabaseMock, permissionRpcMock } =
  vi.hoisted(() => ({
    deleteConnectionMock: vi.fn(),
    requireSupabaseMock: vi.fn(),
    permissionRpcMock: vi.fn(),
  }));

vi.mock("@/lib/api/services/email-connection-service", () => ({
  EmailConnectionService: {
    deleteConnection: deleteConnectionMock,
  },
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: permissionRpcMock }),
}));

import { PersonalEmailConnectionLifecycleService } from "@/lib/api/services/personal-email-connection-lifecycle-service";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000003";

function personalConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: CONNECTION_ID,
    companyId: COMPANY_ID,
    type: "individual" as const,
    userId: ACTOR_ID,
    email: "jason@example.com",
    ...overrides,
  };
}

function createAccessDatabase(): SupabaseClient {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    email_connections: [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "individual",
        user_id: ACTOR_ID,
        status: "disconnected",
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        company_id: COMPANY_ID,
        type: "company",
        user_id: null,
        status: "active",
      },
    ],
    email_threads: [
      {
        id: "00000000-0000-4000-8000-000000000005",
        company_id: COMPANY_ID,
        connection_id: CONNECTION_ID,
        provider_thread_id: "provider-thread-personal",
        opportunity_id: "00000000-0000-4000-8000-000000000006",
      },
    ],
    opportunity_email_threads: [
      {
        id: "00000000-0000-4000-8000-000000000007",
        connection_id: CONNECTION_ID,
        thread_id: "provider-thread-personal",
        opportunity_id: "00000000-0000-4000-8000-000000000006",
      },
    ],
    opportunities: [
      {
        id: "00000000-0000-4000-8000-000000000006",
        company_id: COMPANY_ID,
        assigned_to: ACTOR_ID,
        deleted_at: null,
      },
    ],
  };

  return {
    rpc: async () => ({ data: true, error: null }),
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        is(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        async maybeSingle() {
          const matches = (rows[table] ?? []).filter((row) =>
            filters.every((filter) => filter(row))
          );
          return { data: matches[0] ?? null, error: null };
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: {
                data: Array<Record<string, unknown>>;
                error: null;
              }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null
        ) {
          const matches = (rows[table] ?? []).filter((row) =>
            filters.every((filter) => filter(row))
          );
          return Promise.resolve({ data: matches, error: null }).then(
            onfulfilled,
            onrejected
          );
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("personal email connection disable lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteConnectionMock.mockResolvedValue(undefined);
    permissionRpcMock.mockResolvedValue({ data: true, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disconnects the exact personal connection and reconciles its durable warning", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          affected_conversation_count: 2,
          notified_user_count: 3,
          resolved_notification_count: 0,
        },
      ],
      error: null,
    }));
    const signatureQuery = {
      select: () => signatureQuery,
      eq: () => signatureQuery,
      is: () => signatureQuery,
      lte: () => signatureQuery,
      order: () => signatureQuery,
      limit: async () => ({ data: [], error: null }),
    };
    requireSupabaseMock.mockReturnValue({
      rpc,
      from: vi.fn(() => signatureQuery),
    });

    const result =
      await PersonalEmailConnectionLifecycleService.disconnect(
        personalConnection()
      );

    expect(deleteConnectionMock).toHaveBeenCalledWith(CONNECTION_ID);
    expect(rpc).toHaveBeenCalledWith(
      "process_personal_mailbox_lifecycle_event",
      { p_connection_id: CONNECTION_ID }
    );
    expect(result).toEqual({
      state: "processed",
      affectedConversationCount: 2,
      notifiedUserCount: 3,
      resolvedNotificationCount: 0,
    });
  });

  it("keeps the mailbox disabled and reports queued reconciliation when notification processing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    requireSupabaseMock.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "notification write unavailable" },
      })),
    });

    await expect(
      PersonalEmailConnectionLifecycleService.disconnect(personalConnection())
    ).resolves.toEqual({
      state: "queued",
      affectedConversationCount: null,
      notifiedUserCount: null,
      resolvedNotificationCount: null,
    });
    expect(deleteConnectionMock).toHaveBeenCalledWith(CONNECTION_ID);
  });

  it("refuses to run the personal lifecycle for a company mailbox", async () => {
    requireSupabaseMock.mockReturnValue({ rpc: vi.fn() });

    await expect(
      PersonalEmailConnectionLifecycleService.disconnect(
        personalConnection({ type: "company", userId: null })
      )
    ).rejects.toThrow("personal email connection required");
    expect(deleteConnectionMock).not.toHaveBeenCalled();
  });

  it("drains each pending exact connection id through the idempotent processor", async () => {
    const pendingIds = [
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
    ];
    const rpc = vi.fn(async () => ({
      data: [
        {
          affected_conversation_count: 0,
          notified_user_count: 0,
          resolved_notification_count: 1,
        },
      ],
      error: null,
    }));
    const query = {
      select: () => query,
      is: () => query,
      lte: () => query,
      order: () => query,
      limit: async () => ({
        data: pendingIds.map((connectionId) => ({
          connection_id: connectionId,
        })),
        error: null,
      }),
    };
    const supabase = {
      from: vi.fn(() => query),
      rpc,
    } as unknown as SupabaseClient;

    await expect(
      PersonalEmailConnectionLifecycleService.drainPending(25, supabase)
    ).resolves.toEqual({ selected: 2, processed: 2, failed: 0 });
    expect(rpc.mock.calls).toEqual(
      pendingIds.map((connectionId) => [
        "process_personal_mailbox_lifecycle_event",
        { p_connection_id: connectionId },
      ])
    );
  });

  it("denies a disabled personal-thread send without falling back to an active company mailbox", async () => {
    const result = await resolveEmailOpportunityAccess({
      actor: { userId: ACTOR_ID, companyId: COMPANY_ID },
      operation: "send",
      threadId: "00000000-0000-4000-8000-000000000005",
      supabase: createAccessDatabase(),
    });

    expect(result).toEqual({
      allowed: false,
      reason: "mailbox_transport_denied",
    });
  });
});

describe("personal mailbox lifecycle migration contract", () => {
  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/20260715164000_personal_mailbox_disable_lifecycle.sql"
  );

  it("persists a deduplicated retryable lifecycle event", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain(
      "create table if not exists public.email_connection_lifecycle_outbox"
    );
    expect(sql).toContain("primary key (connection_id)");
    expect(sql).toContain("on conflict (connection_id) do update");
    expect(sql).toContain("processed_at = null");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain(
      "grant select, update\n  on table public.email_connection_lifecycle_outbox to service_role"
    );
    expect(sql).not.toContain(
      "grant execute on function public.enqueue_personal_mailbox_lifecycle_event"
    );
  });

  it("counts only exact-connection threads linked to active leads", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain("thread.connection_id = p_connection_id");
    expect(sql).toContain("link.connection_id = p_connection_id");
    expect(sql).toContain("link.thread_id = thread.provider_thread_id");
    expect(sql).toContain("opportunity.archived_at is null");
    expect(sql).toContain("opportunity.deleted_at is null");
    expect(sql).toContain(
      "opportunity.stage not in ('won', 'lost', 'discarded')"
    );
  });

  it("warns every active pipeline.assign:all user once with the required recovery paths", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain(
      "private.effective_pipeline_scope_for_user(\n        candidate.id, v_company_uuid, 'pipeline.assign'\n      ) = 'all'"
    );
    expect(sql).toContain(
      "private.effective_pipeline_scope_for_user(\n        candidate.id, v_company_uuid, 'pipeline.edit'\n      ) = 'all'"
    );
    expect(sql).toContain(
      "private.effective_pipeline_scope_for_user(\n        candidate.id, v_company_uuid, 'pipeline.view'\n      ) = 'all'"
    );
    expect(sql).toContain("personal-mailbox-unavailable:");
    expect(sql).toContain("reconnect it, set external forwarding");
    expect(sql).toContain("start a new client conversation");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("persistent");
  });

  it("resolves the warning after reconnect or when no active impact remains", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain(
      "v_connection.status = 'active'\n     and v_connection.sync_enabled"
    );
    expect(sql).toContain(
      "v_connection_status = 'active'\n     and v_sync_enabled"
    );
    expect(sql).toContain("mailbox_reconnected");
    expect(sql).toContain("mailbox_impact_cleared");
    expect(sql).toContain("resolved_at = clock_timestamp()");
  });

  it("queues reconciliation for connection, thread, relationship, and lead state changes", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain("on public.email_connections");
    expect(sql).toContain("on public.email_threads");
    expect(sql).toContain("on public.opportunity_email_threads");
    expect(sql).toContain("on public.opportunities");
  });

  it("backfills non-active personal connections without touching company mailboxes", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain("where connection.type::text = 'individual'");
    expect(sql).toContain("connection.status <> 'active'");
    expect(sql).toContain("or not connection.sync_enabled");
    expect(sql).toContain("'migration_backfill'");
  });
});
