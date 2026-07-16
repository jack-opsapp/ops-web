import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  resolvePhaseCEmailActor,
  type PhaseCEmailAuthorizationResolver,
} from "@/lib/email/phase-c-email-actor";

type Row = Record<string, unknown>;
type TableName =
  | "email_connections"
  | "opportunities"
  | "opportunity_assignment_events"
  | "users";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_COMPANY_ID = "00000000-0000-4000-8000-000000000002";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000003";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000004";
const INTERNAL_THREAD_ID = "00000000-0000-4000-8000-000000000005";
const ASSIGNEE_ID = "00000000-0000-4000-8000-000000000006";
const CONNECTION_OWNER_ID = "00000000-0000-4000-8000-000000000007";
const ASSIGNMENT_EVENT_ID = "00000000-0000-4000-8000-000000000008";
const PROVIDER_THREAD_ID = "provider-thread-1";

interface QueryRecord {
  table: TableName;
  filters: Array<{ column: string; value: unknown }>;
}

function baseRows(): Record<TableName, Row[]> {
  return {
    email_connections: [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        type: "company",
        user_id: CONNECTION_OWNER_ID,
        email: "dispatch@canpro.example",
        status: "active",
        sync_enabled: true,
      },
    ],
    opportunities: [
      {
        id: OPPORTUNITY_ID,
        company_id: COMPANY_ID,
        assigned_to: ASSIGNEE_ID,
        assignment_version: 7,
        deleted_at: null,
      },
    ],
    opportunity_assignment_events: [
      {
        id: ASSIGNMENT_EVENT_ID,
        company_id: COMPANY_ID,
        opportunity_id: OPPORTUNITY_ID,
        created_at: "2026-07-15T18:00:00.000Z",
      },
    ],
    users: [
      {
        id: ASSIGNEE_ID,
        company_id: COMPANY_ID,
        first_name: "Jason",
        last_name: "Zavarella",
        email: "jason.login@example.com",
        is_active: true,
        deleted_at: null,
      },
      {
        id: CONNECTION_OWNER_ID,
        company_id: COMPANY_ID,
        first_name: "Mailbox",
        last_name: "Owner",
        email: "dispatch@canpro.example",
        is_active: true,
        deleted_at: null,
      },
    ],
  };
}

function createDatabase(rows = baseRows()): {
  db: SupabaseClient;
  queries: QueryRecord[];
} {
  const queries: QueryRecord[] = [];
  const db = {
    from(table: TableName) {
      const filters: Array<{ column: string; value: unknown }> = [];
      let descending = false;
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return query;
        },
        is(column: string, value: unknown) {
          filters.push({ column, value });
          return query;
        },
        order(_column: string, options?: { ascending?: boolean }) {
          descending = options?.ascending === false;
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          queries.push({ table, filters: [...filters] });
          let matches = (rows[table] ?? []).filter((row) =>
            filters.every(({ column, value }) => row[column] === value)
          );
          if (descending) matches = [...matches].reverse();
          return { data: matches[0] ?? null, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  return { db, queries };
}

function allowAuthorization(): PhaseCEmailAuthorizationResolver {
  return vi.fn(async () => ({ allowed: true as const }));
}

function resolveWith(options?: {
  rows?: Record<TableName, Row[]>;
  expectedAssignmentVersion?: number;
  authorize?: PhaseCEmailAuthorizationResolver;
}) {
  const database = createDatabase(options?.rows);
  const authorize = options?.authorize ?? allowAuthorization();
  return {
    result: resolvePhaseCEmailActor({
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      expectedAssignmentVersion: options?.expectedAssignmentVersion,
      supabase: database.db,
      authorize,
    }),
    authorize,
    queries: database.queries,
  };
}

describe("resolvePhaseCEmailActor", () => {
  it("uses the current assigned OPS user for a shared company mailbox", async () => {
    const { result, authorize, queries } = resolveWith();

    await expect(result).resolves.toEqual({
      kind: "resolved",
      context: {
        actorUserId: ASSIGNEE_ID,
        assignmentVersion: 7,
        assignmentEventId: ASSIGNMENT_EVENT_ID,
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        internalThreadId: INTERNAL_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        connectionType: "company",
        actorNameSnapshot: "Jason Zavarella",
        actorEmailSnapshot: "jason.login@example.com",
        clientFacingAddressSnapshot: "dispatch@canpro.example",
      },
    });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ASSIGNEE_ID,
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        internalThreadId: INTERNAL_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
      })
    );
    expect(
      queries
        .filter((query) => query.table === "users")
        .flatMap((query) => query.filters)
    ).not.toContainEqual(expect.objectContaining({ column: "email" }));
  });

  it("returns typed no-work for an unassigned lead", async () => {
    const rows = baseRows();
    rows.opportunities[0].assigned_to = null;
    const { result, authorize } = resolveWith({ rows });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "opportunity_unassigned",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("uses the active canonical owner for a personal mailbox despite a different send-as address", async () => {
    const rows = baseRows();
    rows.email_connections[0] = {
      ...rows.email_connections[0],
      type: "individual",
      user_id: CONNECTION_OWNER_ID,
      email: "sales-alias@example.com",
    };
    rows.opportunities[0].assigned_to = CONNECTION_OWNER_ID;
    const { result, authorize } = resolveWith({ rows });

    await expect(result).resolves.toMatchObject({
      kind: "resolved",
      context: {
        actorUserId: CONNECTION_OWNER_ID,
        actorEmailSnapshot: "dispatch@canpro.example",
        clientFacingAddressSnapshot: "sales-alias@example.com",
        connectionType: "individual",
      },
    });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: CONNECTION_OWNER_ID })
    );
  });

  it("never lets a new assignee use another user's personal mailbox", async () => {
    const rows = baseRows();
    rows.email_connections[0] = {
      ...rows.email_connections[0],
      type: "individual",
      user_id: CONNECTION_OWNER_ID,
    };
    const { result, authorize } = resolveWith({ rows });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "personal_owner_not_assignee",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("returns typed no-work when the canonical actor is inactive", async () => {
    const rows = baseRows();
    rows.users[0].is_active = false;
    const { result, authorize } = resolveWith({ rows });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "actor_inactive",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("returns typed no-work when the canonical actor is not explicitly active", async () => {
    const rows = baseRows();
    rows.users[0].is_active = null;
    const { result, authorize } = resolveWith({ rows });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "actor_inactive",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("returns typed no-work for a cross-company assigned user", async () => {
    const rows = baseRows();
    rows.users[0].company_id = OTHER_COMPANY_ID;
    const { result, authorize } = resolveWith({ rows });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "actor_cross_company",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("rejects a stale expected assignment version before authorization", async () => {
    const { result, authorize } = resolveWith({
      expectedAssignmentVersion: 6,
    });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "assignment_stale",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("returns typed no-work when reassignment commits during authorization", async () => {
    const rows = baseRows();
    const authorize = vi.fn(async () => {
      rows.opportunities[0].assigned_to = CONNECTION_OWNER_ID;
      rows.opportunities[0].assignment_version = 8;
      return { allowed: true as const };
    });
    const { result } = resolveWith({ rows, authorize });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "assignment_stale",
    });
  });

  it("returns typed no-work when the canonical lead/thread intersection denies the actor", async () => {
    const authorize = vi.fn(async () => ({
      allowed: false as const,
      reason: "missing_pipeline_permission",
    }));
    const { result } = resolveWith({ authorize });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "lead_thread_unauthorized",
      authorizationReason: "missing_pipeline_permission",
    });
  });
});
