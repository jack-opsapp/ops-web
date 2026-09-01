import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

const canonicalDependencies = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
  resolveEmailOpportunityAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: canonicalDependencies.getServiceRoleClient,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess:
    canonicalDependencies.resolveEmailOpportunityAccess,
}));

import {
  isResolvedPhaseCEmailActorContext,
  resolvePhaseCEmailActor,
  type ResolvePhaseCEmailActorInput,
} from "@/lib/email/phase-c-email-actor";

type Row = Record<string, unknown>;
type TableName =
  | "email_connections"
  | "email_threads"
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
        provider: "gmail",
        type: "company",
        user_id: CONNECTION_OWNER_ID,
        email: "dispatch@canpro.example",
        status: "active",
        sync_enabled: true,
      },
    ],
    email_threads: [
      {
        id: INTERNAL_THREAD_ID,
        company_id: COMPANY_ID,
        connection_id: CONNECTION_ID,
        provider_thread_id: PROVIDER_THREAD_ID,
        opportunity_id: OPPORTUNITY_ID,
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

function createDatabase(
  rows = baseRows(),
  beforeRead?: (table: TableName) => Promise<void>,
  fenceResponse?: unknown
): {
  db: SupabaseClient;
  queries: QueryRecord[];
  rpc: ReturnType<typeof vi.fn>;
} {
  const queries: QueryRecord[] = [];
  const rpc = vi.fn(
    async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "authorize_opportunity_action_as_system") {
        return { data: true, error: null };
      }
      if (functionName !== "read_phase_c_routed_actor_fence_as_system") {
        return { data: null, error: { message: "unexpected rpc" } };
      }
      if (fenceResponse !== undefined) return fenceResponse;

      const connection = rows.email_connections.find(
        (row) =>
          row.id === args.p_connection_id &&
          row.company_id === args.p_company_id &&
          row.provider === args.p_connection_provider &&
          row.status === "active" &&
          row.sync_enabled !== false
      );
      const opportunity = rows.opportunities.find(
        (row) =>
          row.id === args.p_opportunity_id &&
          row.company_id === args.p_company_id &&
          row.assigned_to === args.p_actor_user_id &&
          row.assignment_version === args.p_assignment_version &&
          row.deleted_at === null
      );
      const thread = rows.email_threads.find(
        (row) =>
          row.id === args.p_internal_thread_id &&
          row.company_id === args.p_company_id &&
          row.connection_id === args.p_connection_id &&
          row.provider_thread_id === args.p_provider_thread_id &&
          row.opportunity_id === args.p_opportunity_id
      );
      const owner =
        typeof connection?.user_id === "string"
          ? connection.user_id.trim()
          : null;
      const connectionAllowed =
        connection?.type === "company" ||
        (connection?.type === "individual" &&
          owner === args.p_actor_user_id &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            owner ?? ""
          ));
      const actor = rows.users.find(
        (row) =>
          row.id === args.p_actor_user_id &&
          row.company_id === args.p_company_id &&
          row.is_active === true &&
          row.deleted_at === null
      );

      if (
        !connection ||
        !opportunity ||
        !thread ||
        !connectionAllowed ||
        !actor
      ) {
        return { data: [], error: null };
      }
      return {
        data: [
          {
            actor_user_id: args.p_actor_user_id,
            company_id: args.p_company_id,
            connection_id: args.p_connection_id,
            opportunity_id: args.p_opportunity_id,
            internal_thread_id: args.p_internal_thread_id,
            provider_thread_id: args.p_provider_thread_id,
            assignment_version: args.p_assignment_version,
            connection_type: connection.type,
            connection_provider: connection.provider,
            connection_email: connection.email,
          },
        ],
        error: null,
      };
    }
  );
  const db = {
    rpc,
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
          await beforeRead?.(table);
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

  return { db, queries, rpc };
}

type TestAuthorizationResolver = (
  input: unknown
) => Promise<{ allowed: true } | { allowed: false; reason: string }>;

function resolveWith(options?: {
  rows?: Record<TableName, Row[]>;
  expectedAssignmentVersion?: number;
  authorize?: TestAuthorizationResolver;
}) {
  const database = createDatabase(options?.rows);
  const authorize = vi.fn(
    options?.authorize ?? (async () => ({ allowed: true as const }))
  );
  canonicalDependencies.getServiceRoleClient.mockReturnValue(database.db);
  canonicalDependencies.resolveEmailOpportunityAccess.mockImplementation(
    authorize
  );
  return {
    result: resolvePhaseCEmailActor({
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      expectedAssignmentVersion: options?.expectedAssignmentVersion,
    }),
    authorize,
    queries: database.queries,
  };
}

describe("resolvePhaseCEmailActor", () => {
  it("does not expose or honor caller-supplied database or authorization dependencies", async () => {
    expectTypeOf<keyof ResolvePhaseCEmailActorInput>().toEqualTypeOf<
      | "companyId"
      | "connectionId"
      | "opportunityId"
      | "internalThreadId"
      | "providerThreadId"
      | "expectedAssignmentVersion"
      | "operation"
      | "opportunityAction"
    >();

    const canonical = createDatabase({
      ...baseRows(),
      opportunities: [],
    });
    const fabricated = createDatabase(baseRows());
    const injectedAuthorize = vi.fn(async () => ({ allowed: true as const }));
    canonicalDependencies.getServiceRoleClient.mockReturnValue(canonical.db);
    canonicalDependencies.resolveEmailOpportunityAccess.mockResolvedValue({
      allowed: false,
      reason: "missing_pipeline_permission",
    });

    const input = {
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      supabase: fabricated.db,
      authorize: injectedAuthorize,
    };
    await expect(resolvePhaseCEmailActor(input as never)).resolves.toEqual({
      kind: "no_work",
      reason: "invalid_identifiers",
    });
    expect(injectedAuthorize).not.toHaveBeenCalled();
    expect(canonicalDependencies.getServiceRoleClient).not.toHaveBeenCalled();
    expect(
      canonicalDependencies.resolveEmailOpportunityAccess
    ).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed and proxy-trapped inputs without invoking or leaking them", async () => {
    let accessorReads = 0;
    const accessorInput = {
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
    } as Record<string, unknown>;
    Object.defineProperty(accessorInput, "companyId", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("RAW_PRIVATE_GETTER_SENTINEL");
      },
    });
    const proxyInput = new Proxy(
      {
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        internalThreadId: INTERNAL_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
      },
      {
        getOwnPropertyDescriptor() {
          throw new Error("RAW_PRIVATE_PROXY_SENTINEL");
        },
      }
    );
    const transparentProxyInput = new Proxy(
      {
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        internalThreadId: INTERNAL_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
      },
      {}
    );

    await expect(
      resolvePhaseCEmailActor(accessorInput as never)
    ).resolves.toEqual({ kind: "no_work", reason: "invalid_identifiers" });
    await expect(resolvePhaseCEmailActor(proxyInput)).resolves.toEqual({
      kind: "no_work",
      reason: "invalid_identifiers",
    });
    await expect(
      resolvePhaseCEmailActor(transparentProxyInput)
    ).resolves.toEqual({
      kind: "no_work",
      reason: "invalid_identifiers",
    });
    expect(accessorReads).toBe(0);
    expect(canonicalDependencies.getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects missing, extra, non-enumerable, or malformed authority fields before lookup", async () => {
    const valid = {
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
    };
    const missingCompanyId = { ...valid };
    Reflect.deleteProperty(missingCompanyId, "companyId");
    const nonEnumerableOperation = { ...valid };
    Object.defineProperty(nonEnumerableOperation, "operation", {
      enumerable: false,
      value: "send",
    });

    for (const malformed of [
      missingCompanyId,
      { ...valid, extraAuthority: true },
      nonEnumerableOperation,
      { ...valid, providerThreadId: "   " },
      { ...valid, providerThreadId: ` ${PROVIDER_THREAD_ID}` },
      { ...valid, providerThreadId: "provider\u0000thread" },
      { ...valid, providerThreadId: "é".repeat(257) },
      {
        ...valid,
        companyId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
      {
        ...valid,
        connectionId: "00000000-0000-0000-0000-000000000000",
      },
      {
        ...valid,
        opportunityId: "00000000-0000-0000-8000-000000000004",
      },
      { ...valid, opportunityId: undefined },
      { ...valid, expectedAssignmentVersion: -1 },
      { ...valid, expectedAssignmentVersion: 1.5 },
      { ...valid, operation: "mutate" },
      { ...valid, opportunityAction: "delete" },
    ]) {
      canonicalDependencies.getServiceRoleClient.mockClear();
      await expect(
        resolvePhaseCEmailActor(malformed as never)
      ).resolves.toEqual({ kind: "no_work", reason: "invalid_identifiers" });
      expect(canonicalDependencies.getServiceRoleClient).not.toHaveBeenCalled();
    }
  });

  it("uses one immutable authorization snapshot while the first canonical read is pending", async () => {
    let releaseConnectionRead: (() => void) | undefined;
    const connectionReadPending = new Promise<void>((resolve) => {
      releaseConnectionRead = resolve;
    });
    const database = createDatabase(baseRows(), async (table) => {
      if (table === "email_connections") await connectionReadPending;
    });
    canonicalDependencies.resolveEmailOpportunityAccess.mockClear();
    canonicalDependencies.getServiceRoleClient.mockReturnValue(database.db);
    canonicalDependencies.resolveEmailOpportunityAccess.mockResolvedValue({
      allowed: true,
    });
    const mutableInput = {
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      expectedAssignmentVersion: 7 as number | null | undefined,
      operation: "send" as "read" | "edit" | "send",
      opportunityAction: "convert" as "view" | "edit" | "convert" | undefined,
    };

    const resolution = resolvePhaseCEmailActor(mutableInput);
    mutableInput.companyId = OTHER_COMPANY_ID;
    mutableInput.connectionId = "00000000-0000-4000-8000-000000000031";
    mutableInput.opportunityId = "00000000-0000-4000-8000-000000000032";
    mutableInput.internalThreadId = "00000000-0000-4000-8000-000000000033";
    mutableInput.providerThreadId = "provider-thread-attacker";
    mutableInput.expectedAssignmentVersion = undefined;
    mutableInput.operation = "read";
    mutableInput.opportunityAction = undefined;
    releaseConnectionRead?.();

    await expect(resolution).resolves.toMatchObject({
      kind: "resolved",
      context: {
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        internalThreadId: INTERNAL_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        assignmentVersion: 7,
      },
    });
    expect(
      canonicalDependencies.resolveEmailOpportunityAccess
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { userId: ASSIGNEE_ID, companyId: COMPANY_ID },
        operation: "send",
        threadId: INTERNAL_THREAD_ID,
        connectionId: CONNECTION_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        opportunityId: OPPORTUNITY_ID,
      })
    );
    expect(database.rpc).toHaveBeenCalledWith(
      "authorize_opportunity_action_as_system",
      {
        p_actor_user_id: ASSIGNEE_ID,
        p_opportunity_id: OPPORTUNITY_ID,
        p_action: "convert",
      }
    );
    expect(database.rpc).toHaveBeenCalledWith(
      "read_phase_c_routed_actor_fence_as_system",
      {
        p_company_id: COMPANY_ID,
        p_connection_id: CONNECTION_ID,
        p_connection_provider: "gmail",
        p_opportunity_id: OPPORTUNITY_ID,
        p_actor_user_id: ASSIGNEE_ID,
        p_assignment_version: 7,
        p_internal_thread_id: INTERNAL_THREAD_ID,
        p_provider_thread_id: PROVIDER_THREAD_ID,
      }
    );
  });

  it("cannot drop a stale expected-assignment fence while a canonical read is pending", async () => {
    let releaseConnectionRead: (() => void) | undefined;
    const connectionReadPending = new Promise<void>((resolve) => {
      releaseConnectionRead = resolve;
    });
    const database = createDatabase(baseRows(), async (table) => {
      if (table === "email_connections") await connectionReadPending;
    });
    canonicalDependencies.resolveEmailOpportunityAccess.mockClear();
    canonicalDependencies.getServiceRoleClient.mockReturnValue(database.db);
    canonicalDependencies.resolveEmailOpportunityAccess.mockResolvedValue({
      allowed: true,
    });
    const mutableInput = {
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      expectedAssignmentVersion: 6 as number | null | undefined,
      operation: "send" as const,
      opportunityAction: "convert" as const,
    };

    const resolution = resolvePhaseCEmailActor(mutableInput);
    mutableInput.expectedAssignmentVersion = undefined;
    releaseConnectionRead?.();

    await expect(resolution).resolves.toEqual({
      kind: "no_work",
      reason: "assignment_stale",
    });
    expect(
      canonicalDependencies.resolveEmailOpportunityAccess
    ).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it("contains canonical database initialization failures as typed no-work", async () => {
    canonicalDependencies.getServiceRoleClient.mockImplementation(() => {
      throw new Error("private service-role configuration detail");
    });

    await expect(
      resolvePhaseCEmailActor({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        internalThreadId: INTERNAL_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
      })
    ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
  });

  it("mints non-transferable routed authority only after the canonical checks pass", async () => {
    const resolution = await resolveWith().result;

    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;

    expect(isResolvedPhaseCEmailActorContext(resolution.context)).toBe(true);
    expect(isResolvedPhaseCEmailActorContext({ ...resolution.context })).toBe(
      false
    );
    expect(Object.isFrozen(resolution.context)).toBe(true);
  });

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
        actor: {
          userId: ASSIGNEE_ID,
          companyId: COMPANY_ID,
        },
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        threadId: INTERNAL_THREAD_ID,
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
      expect.objectContaining({
        actor: expect.objectContaining({ userId: CONNECTION_OWNER_ID }),
      })
    );
  });

  it("normalizes the canonical OPS owner id stored on a personal mailbox", async () => {
    const rows = baseRows();
    rows.email_connections[0] = {
      ...rows.email_connections[0],
      type: "individual",
      user_id: `  ${CONNECTION_OWNER_ID}  `,
      email: "sales-alias@example.com",
    };
    rows.opportunities[0].assigned_to = CONNECTION_OWNER_ID;
    const { result, authorize } = resolveWith({ rows });

    await expect(result).resolves.toMatchObject({
      kind: "resolved",
      context: {
        actorUserId: CONNECTION_OWNER_ID,
        connectionType: "individual",
      },
    });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ userId: CONNECTION_OWNER_ID }),
      })
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

  it("does not mint routed authority when a personal mailbox owner changes during authorization", async () => {
    const rows = baseRows();
    rows.email_connections[0] = {
      ...rows.email_connections[0],
      type: "individual",
      user_id: ASSIGNEE_ID,
    };
    const authorize = vi.fn(async () => {
      rows.email_connections[0].user_id = CONNECTION_OWNER_ID;
      return { allowed: true as const };
    });
    const { result } = resolveWith({ rows, authorize });

    const resolution = await result;
    expect(resolution).toEqual({
      kind: "no_work",
      reason: "assignment_stale",
    });
    expect(
      resolution.kind === "resolved" &&
        isResolvedPhaseCEmailActorContext(resolution.context)
    ).toBe(false);
  });

  it("does not mint routed authority when a company mailbox becomes another actor's personal mailbox", async () => {
    const rows = baseRows();
    const authorize = vi.fn(async () => {
      rows.email_connections[0].type = "individual";
      rows.email_connections[0].user_id = CONNECTION_OWNER_ID;
      return { allowed: true as const };
    });
    const { result } = resolveWith({ rows, authorize });

    await expect(result).resolves.toEqual({
      kind: "no_work",
      reason: "assignment_stale",
    });
  });

  it("preserves current company-mailbox semantics when connector ownership metadata changes", async () => {
    const rows = baseRows();
    const authorize = vi.fn(async () => {
      rows.email_connections[0].user_id = ASSIGNEE_ID;
      return { allowed: true as const };
    });
    const { result } = resolveWith({ rows, authorize });

    await expect(result).resolves.toMatchObject({
      kind: "resolved",
      context: {
        actorUserId: ASSIGNEE_ID,
        connectionType: "company",
      },
    });
  });

  it.each([
    [
      "company",
      (rows: Record<TableName, Row[]>) => {
        rows.email_connections[0].company_id = OTHER_COMPANY_ID;
      },
    ],
    [
      "provider",
      (rows: Record<TableName, Row[]>) => {
        rows.email_connections[0].provider = "microsoft365";
      },
    ],
    [
      "status",
      (rows: Record<TableName, Row[]>) => {
        rows.email_connections[0].status = "paused";
      },
    ],
    [
      "sync state",
      (rows: Record<TableName, Row[]>) => {
        rows.email_connections[0].sync_enabled = false;
      },
    ],
    [
      "thread opportunity",
      (rows: Record<TableName, Row[]>) => {
        rows.email_threads[0].opportunity_id = null;
      },
    ],
  ])(
    "does not mint routed authority when the current %s changes during authorization",
    async (_field, mutate) => {
      const rows = baseRows();
      const authorize = vi.fn(async () => {
        mutate(rows);
        return { allowed: true as const };
      });
      const { result } = resolveWith({ rows, authorize });

      const resolution = await result;
      expect(resolution).toEqual({
        kind: "no_work",
        reason: "assignment_stale",
      });
      expect(
        resolution.kind === "resolved" &&
          isResolvedPhaseCEmailActorContext(resolution.context)
      ).toBe(false);
    }
  );

  it.each([
    { data: [], error: { message: "private fence error" } },
    { data: [{ actor_user_id: ASSIGNEE_ID }], error: null },
    {
      data: [
        {
          actor_user_id: ASSIGNEE_ID,
          company_id: COMPANY_ID,
          connection_id: CONNECTION_ID,
          opportunity_id: OPPORTUNITY_ID,
          internal_thread_id: INTERNAL_THREAD_ID,
          provider_thread_id: PROVIDER_THREAD_ID,
          assignment_version: 7,
          connection_type: "company",
          connection_provider: "gmail",
          connection_email: "dispatch@canpro.example",
        },
        {
          actor_user_id: ASSIGNEE_ID,
          company_id: COMPANY_ID,
          connection_id: CONNECTION_ID,
          opportunity_id: OPPORTUNITY_ID,
          internal_thread_id: INTERNAL_THREAD_ID,
          provider_thread_id: PROVIDER_THREAD_ID,
          assignment_version: 7,
          connection_type: "company",
          connection_provider: "gmail",
          connection_email: "dispatch@canpro.example",
        },
      ],
      error: null,
    },
  ])(
    "contains a malformed final actor fence as lookup failure",
    async (response) => {
      const database = createDatabase(baseRows(), undefined, response);
      canonicalDependencies.getServiceRoleClient.mockReturnValue(database.db);
      canonicalDependencies.resolveEmailOpportunityAccess.mockResolvedValue({
        allowed: true,
      });

      await expect(
        resolvePhaseCEmailActor({
          companyId: COMPANY_ID,
          connectionId: CONNECTION_ID,
          opportunityId: OPPORTUNITY_ID,
          internalThreadId: INTERNAL_THREAD_ID,
          providerThreadId: PROVIDER_THREAD_ID,
        })
      ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
    }
  );

  it("rejects non-exact final fence arrays and rows without reading accessors", async () => {
    let actorReads = 0;
    let arrayReads = 0;
    const validRow = {
      actor_user_id: ASSIGNEE_ID,
      company_id: COMPANY_ID,
      connection_id: CONNECTION_ID,
      opportunity_id: OPPORTUNITY_ID,
      internal_thread_id: INTERNAL_THREAD_ID,
      provider_thread_id: PROVIDER_THREAD_ID,
      assignment_version: 7,
      connection_type: "company",
      connection_provider: "gmail",
      connection_email: "dispatch@canpro.example",
    };
    const accessorRow = {
      company_id: COMPANY_ID,
      connection_id: CONNECTION_ID,
      opportunity_id: OPPORTUNITY_ID,
      internal_thread_id: INTERNAL_THREAD_ID,
      provider_thread_id: PROVIDER_THREAD_ID,
      assignment_version: 7,
      connection_type: "company",
      connection_provider: "gmail",
      connection_email: "dispatch@canpro.example",
    } as Record<string, unknown>;
    Object.defineProperty(accessorRow, "actor_user_id", {
      enumerable: true,
      get() {
        actorReads += 1;
        return ASSIGNEE_ID;
      },
    });
    const extraRow = { ...validRow, private_extra: true };
    const symbolRow = { ...validRow } as Record<PropertyKey, unknown>;
    symbolRow[Symbol("private-row")] = true;
    const hiddenRow = { ...validRow };
    Object.defineProperty(hiddenRow, "private_hidden", {
      enumerable: false,
      value: true,
    });
    const sparseArray = new Array(1);
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      configurable: true,
      enumerable: true,
      get() {
        arrayReads += 1;
        return validRow;
      },
    });
    const extraArray = [validRow] as unknown[] & Record<string, unknown>;
    extraArray.private_extra = true;
    const symbolArray = [validRow] as unknown[] & Record<PropertyKey, unknown>;
    symbolArray[Symbol("private-array")] = true;
    const hiddenArray = [validRow];
    Object.defineProperty(hiddenArray, "private_hidden", {
      enumerable: false,
      value: true,
    });

    for (const data of [
      new Proxy([validRow], {}),
      [new Proxy(validRow, {})],
      [accessorRow],
      [extraRow],
      [symbolRow],
      [hiddenRow],
      sparseArray,
      accessorArray,
      extraArray,
      symbolArray,
      hiddenArray,
    ]) {
      const database = createDatabase(baseRows(), undefined, {
        data,
        error: null,
      });
      canonicalDependencies.getServiceRoleClient.mockReturnValue(database.db);
      canonicalDependencies.resolveEmailOpportunityAccess.mockResolvedValue({
        allowed: true,
      });

      await expect(
        resolvePhaseCEmailActor({
          companyId: COMPANY_ID,
          connectionId: CONNECTION_ID,
          opportunityId: OPPORTUNITY_ID,
          internalThreadId: INTERNAL_THREAD_ID,
          providerThreadId: PROVIDER_THREAD_ID,
        })
      ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
    }
    expect(actorReads).toBe(0);
    expect(arrayReads).toBe(0);
  });

  it.each([
    ["actor id", { actor_user_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }],
    ["company id", { company_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }],
    [
      "connection id",
      { connection_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    ],
    [
      "opportunity id",
      { opportunity_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    ],
    [
      "thread id",
      { internal_thread_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    ],
    ["provider thread", { provider_thread_id: ` ${PROVIDER_THREAD_ID}` }],
    ["assignment version", { assignment_version: "7.0" }],
    ["connection type", { connection_type: "shared" }],
    ["connection provider", { connection_provider: "GMAIL" }],
    ["connection address", { connection_email: "   " }],
  ])("rejects a noncanonical final fence %s", async (_field, override) => {
    const database = createDatabase(baseRows(), undefined, {
      data: [
        {
          actor_user_id: ASSIGNEE_ID,
          company_id: COMPANY_ID,
          connection_id: CONNECTION_ID,
          opportunity_id: OPPORTUNITY_ID,
          internal_thread_id: INTERNAL_THREAD_ID,
          provider_thread_id: PROVIDER_THREAD_ID,
          assignment_version: 7,
          connection_type: "company",
          connection_provider: "gmail",
          connection_email: "dispatch@canpro.example",
          ...override,
        },
      ],
      error: null,
    });
    canonicalDependencies.getServiceRoleClient.mockReturnValue(database.db);
    canonicalDependencies.resolveEmailOpportunityAccess.mockResolvedValue({
      allowed: true,
    });

    await expect(
      resolvePhaseCEmailActor({
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        internalThreadId: INTERNAL_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
      })
    ).resolves.toEqual({ kind: "no_work", reason: "lookup_failed" });
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
